// src/app/api/losses/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** ========= Schemas ========= **/
const PutLossSchema = z.object({
    lote_id: z.number().int().nullable(),
    piscina_id: z.number().int().nullable(),
    fecha: z
        .string()
        .min(1, 'La fecha es requerida (formato YYYY-MM-DD)')
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (YYYY-MM-DD)'),
    muertos: z.number().int().min(0, 'Muertos debe ser >= 0'),
    faltantes: z.number().int().min(0, 'Faltantes debe ser >= 0'),
    sobrantes: z.number().int().min(0, 'Sobrantes debe ser >= 0'),
    deformes: z.number().int().min(0, 'Deformes debe ser >= 0'),
    active: z.boolean().optional(),
});
const PatchLossSchema = PutLossSchema.partial();

/** ========= Helpers ========= **/
function parseId(param: any) {
    const id = Number(param);
    if (!Number.isInteger(id) || id <= 0) return null;
    return id;
}

/**
 * Comprueba si el OPERADOR tiene un "pase" reciente: verificó un código (auditoría 'CODE_USED')
 * de una solicitud APROBADA en la tabla de solicitudes indicada (edición o inactivación)
 * para la tabla de negocio y registro dados dentro de los últimos N minutos.
 */
async function operadorTienePaseRecienteEnTablaSolicitudes(
    userId: number,
    tablaNegocio: string, // p.ej. 'bajas'
    registroId: number,
    tablaSolicitudes: 'solicitudes_edicion' | 'solicitudes_inactivacion',
    dentroMin = 10
) {
    const client = await pool.connect();
    try {
        const q = `
            SELECT s.id
            FROM ${tablaSolicitudes} s
                     LEFT JOIN LATERAL (
                SELECT
                    (a.detalle->>'used_at')::timestamptz AS used_at,
                        (a.detalle->>'used_by')::int        AS used_by
                FROM auditoria a
                WHERE a.tabla = $4
                  AND a.registro_id = s.id
                  AND a.accion = 'CODE_USED'
                ORDER BY a.id DESC
                    LIMIT 1
      ) au ON TRUE
            WHERE s.tabla = $1
              AND s.registro_id = $2
              AND s.estado = 'APROBADO'
              AND au.used_by = $3
              AND au.used_at >= NOW() - ($5 || ' minutes')::interval
                LIMIT 1
        `;
        const r = await client.query(q, [tablaNegocio, registroId, userId, tablaSolicitudes, String(dentroMin)]);
        return r.rowCount > 0;
    } finally {
        client.release();
    }
}

/** ========= GET ========= **/
export async function GET(req: NextRequest, context: any) {
    const params = await context.params;
    const id = parseId(params?.id);
    if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;

    const client = await pool.connect();
    try {
        const r = await client.query(
            `SELECT b.*, l.nombre AS lote_nombre, p.nombre AS piscina_nombre
             FROM bajas b
                      LEFT JOIN lotes l ON l.id = b.lote_id
                      LEFT JOIN piscinas p ON p.id = b.piscina_id
             WHERE b.id = $1`,
            [id]
        );
        if (r.rowCount === 0) return NextResponse.json({ success: false, msg: 'No encontrado' }, { status: 404 });
        return NextResponse.json({ success: true, data: r.rows[0] });
    } catch (e) {
        console.error('GET /api/losses/:id error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al obtener registro' }, { status: 500 });
    } finally {
        client.release();
    }
}

/** ========= PUT (reemplazo completo) ========= **/
export async function PUT(req: NextRequest, context: any) {
    const params = await context.params;
    const id = parseId(params?.id);
    if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;
    const role = (user.role ?? '').toString().toUpperCase();

    const json = await req.json().catch(() => ({}));
    const parsed = PutLossSchema.safeParse(json);
    if (!parsed.success) {
        const msg = parsed.error.issues?.[0]?.message || 'Datos inválidos';
        return NextResponse.json({ success: false, msg }, { status: 400 });
    }
    const { lote_id, piscina_id, fecha, muertos, faltantes, sobrantes, deformes, active } = parsed.data;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const beforeRes = await client.query(`SELECT * FROM bajas WHERE id=$1`, [id]);
        if (beforeRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Registro no encontrado' }, { status: 404 });
        }

        // AUTORIZACIÓN:
        // - Si PUT incluye active (restaurar/inactivar), exige pase de solicitudes_inactivacion
        // - Si no, exige pase de solicitudes_edicion
        if (role !== 'SUPERADMIN') {
            const incluyeActive = active !== undefined;
            const ok = await operadorTienePaseRecienteEnTablaSolicitudes(
                user.id,
                'bajas',
                id,
                incluyeActive ? 'solicitudes_inactivacion' : 'solicitudes_edicion',
                10
            );
            if (!ok) {
                await client.query('ROLLBACK');
                return NextResponse.json(
                    {
                        success: false,
                        msg: incluyeActive
                            ? 'No autorizado: requiere código válido reciente de inactivación/restauración.'
                            : 'No autorizado: requiere código válido reciente de edición.',
                    },
                    { status: 403 }
                );
            }
        }

        const updRes = await client.query(
            `UPDATE bajas
             SET lote_id=$1, piscina_id=$2, fecha=$3, muertos=$4, faltantes=$5, sobrantes=$6, deformes=$7,
                 editado_por=$8, editado_en=NOW(), active = COALESCE($9, active)
             WHERE id=$10
                 RETURNING *`,
            [
                lote_id,
                piscina_id,
                fecha,
                muertos,
                faltantes,
                sobrantes,
                deformes,
                user.id,
                active === undefined ? null : active,
                id,
            ]
        );

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'bajas',$2,'UPDATE',$3::jsonb)`,
            [user.id, id, JSON.stringify({ old: beforeRes.rows[0], new: updRes.rows[0] })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true, data: updRes.rows[0] });
    } catch (e: any) {
        await client.query('ROLLBACK');
        console.error('PUT /api/losses/:id error', e);
        if (e?.code === '23505') {
            return NextResponse.json({ success: false, msg: 'Conflicto en datos (duplicado)' }, { status: 409 });
        }
        return NextResponse.json({ success: false, msg: 'Error interno al actualizar registro' }, { status: 500 });
    } finally {
        client.release();
    }
}

/** ========= PATCH (parcial) ========= **/
export async function PATCH(req: NextRequest, context: any) {
    const params = await context.params;
    const id = parseId(params?.id);
    if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;
    const role = (user.role ?? '').toString().toUpperCase();

    const json = await req.json().catch(() => ({}));
    const parsed = PatchLossSchema.safeParse(json);
    if (!parsed.success) {
        const msg = parsed.error.issues?.[0]?.message || 'Datos inválidos';
        return NextResponse.json({ success: false, msg }, { status: 400 });
    }
    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ success: false, msg: 'No hay campos para actualizar' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const beforeRes = await client.query(`SELECT * FROM bajas WHERE id=$1`, [id]);
        if (beforeRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Registro no encontrado' }, { status: 404 });
        }

        // AUTORIZACIÓN diferenciada
        if (role !== 'SUPERADMIN') {
            const incluyeActive = Object.prototype.hasOwnProperty.call(updates, 'active');
            const ok = await operadorTienePaseRecienteEnTablaSolicitudes(
                user.id,
                'bajas',
                id,
                incluyeActive ? 'solicitudes_inactivacion' : 'solicitudes_edicion',
                10
            );
            if (!ok) {
                await client.query('ROLLBACK');
                return NextResponse.json(
                    {
                        success: false,
                        msg: incluyeActive
                            ? 'No autorizado: requiere código válido de inactivación/restauración.'
                            : 'No autorizado: requiere código válido de edición.',
                    },
                    { status: 403 }
                );
            }
        }

        const sets: string[] = [];
        const vals: any[] = [];
        let idx = 1;
        for (const key of Object.keys(updates)) {
            if (!['lote_id', 'piscina_id', 'fecha', 'muertos', 'faltantes', 'sobrantes', 'deformes', 'active'].includes(key)) continue;
            sets.push(`${key} = $${idx++}`);
            // @ts-ignore
            vals.push(updates[key]);
        }
        sets.push(`editado_por = $${idx++}`);
        vals.push(user.id);
        sets.push(`editado_en = NOW()`);
        vals.push(id);

        const sql = `UPDATE bajas SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`;
        const updRes = await client.query(sql, vals);

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'bajas',$2,'UPDATE',$3::jsonb)`,
            [user.id, id, JSON.stringify({ old: beforeRes.rows[0], new: updRes.rows[0] })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true, data: updRes.rows[0] });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('PATCH /api/losses/:id error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al actualizar registro' }, { status: 500 });
    } finally {
        client.release();
    }
}

/** ========= DELETE (soft delete) ========= **/
export async function DELETE(req: NextRequest, context: any) {
    const params = await context.params;
    const id = parseId(params?.id);
    if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

    // IMPORTANTE: también permitimos OPERADOR aquí.
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;
    const role = (user.role ?? '').toString().toUpperCase();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const beforeRes = await client.query(`SELECT * FROM bajas WHERE id=$1`, [id]);
        if (beforeRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Registro no encontrado' }, { status: 404 });
        }

        // AUTORIZACIÓN:
        // Para inactivar siempre se exige pase en solicitudes_inactivacion
        if (role !== 'SUPERADMIN') {
            const ok = await operadorTienePaseRecienteEnTablaSolicitudes(
                user.id,
                'bajas',
                id,
                'solicitudes_inactivacion',
                10
            );
            if (!ok) {
                await client.query('ROLLBACK');
                return NextResponse.json(
                    { success: false, msg: 'No autorizado: requiere código válido reciente de inactivación.' },
                    { status: 403 }
                );
            }
        }

        // Soft delete
        await client.query(
            `UPDATE bajas SET active = FALSE, editado_por = $1, editado_en = NOW() WHERE id=$2`,
            [user.id, id]
        );

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'bajas',$2,'DELETE',$3::jsonb)`,
            [user.id, id, JSON.stringify({ old: beforeRes.rows[0], soft_delete: true })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('DELETE /api/losses/:id error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al eliminar registro' }, { status: 500 });
    } finally {
        client.release();
    }
}
