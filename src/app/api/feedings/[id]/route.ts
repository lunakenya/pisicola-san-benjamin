import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Interfaz para el parámetro de ruta dinámico [id]
interface RouteParams {
  id: string; // El nombre 'id' debe coincidir con el nombre de la carpeta dinámica: [id]
}

const PutFeedingSchema = z.object({
    lote_id: z.number().int().nullable(),
    piscina_id: z.number().int().nullable(),
    fecha: z
        .string()
        .min(1, 'La fecha es requerida (formato YYYY-MM-DD)')
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (YYYY-MM-DD)'),
    tipo_alimento_id: z.number().int().nullable(),
    cantidad: z.number().min(0),
    proveedor_id: z.number().int().nullable().optional(),
    nro_factura: z.string().trim().nullable().optional(),
    valor_unitario: z.number().min(0),
    active: z.boolean().optional(),
});
const PatchFeedingSchema = PutFeedingSchema.partial();

function parseId(param: string | string[] | undefined): number | null {
    const id = Number(param);
    if (!Number.isInteger(id) || id <= 0) return null;
    return id;
}

async function operadorTienePaseRecienteEnTablaSolicitudes(
    userId: number,
    tablaNegocio: string,
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
            (a.detalle->>'used_by')::int AS used_by
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

function round3(v: number) { return Math.round(v * 1000) / 1000; }
function round2(v: number) { return Math.round(v * 100) / 100; }

function computeMes(fecha: string): number | null {
    const d = new Date(`${fecha}T12:00:00Z`);
    if (isNaN(d.getTime())) return null;
    return d.getMonth() + 1;
}

/** * GET single feeding
 * CORRECCIÓN CLAVE: El tipado del segundo argumento ahora es Next.js "nativo" (sin interfaz personalizada)
 */
export async function GET(
    req: NextRequest, 
    { params }: { params: { id: string } } // <-- ¡El cambio final!
) {
    // Usamos context.params.id directamente
    const id = parseId(context.params?.id);
    if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;

    const client = await pool.connect();
    try {
        const r = await client.query(
            `SELECT a.*, l.nombre AS lote_nombre, p.nombre AS piscina_nombre, t.nombre AS tipo_alimento_nombre, pr.nombre AS proveedor_nombre
        FROM alimentos a
          LEFT JOIN lotes l ON l.id = a.lote_id
          LEFT JOIN piscinas p ON p.id = a.piscina_id
          LEFT JOIN tipos_alimento t ON t.id = a.tipo_alimento_id
          LEFT JOIN proveedores pr ON pr.id = a.proveedor_id
        WHERE a.id = $1`,
            [id]
        );
        if (r.rowCount === 0) return NextResponse.json({ success: false, msg: 'No encontrado' }, { status: 404 });
        return NextResponse.json({ success: true, data: r.rows[0] });
    } catch (e: unknown) {
        console.error('GET /api/feedings/:id error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al obtener registro' }, { status: 500 });
    } finally {
        client.release();
    }
}

/** * PUT (reemplazo completo)
 * CORRECCIÓN CLAVE: El tipado del segundo argumento ahora es Next.js "nativo"
 */
export async function PUT(
    req: NextRequest, 
    context: { params: RouteParams } 
) {
    const id = parseId(context.params?.id);
    if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;

    // Tipado más seguro para el usuario. Asumimos que 'auth' devuelve un objeto con 'id' y 'role'.
    const user = auth as { id: number; role: string; };
    const role = (user.role ?? '').toString().toUpperCase();

    const json = await req.json().catch(() => ({}));
    const parsed = PutFeedingSchema.safeParse(json);
    if (!parsed.success) {
        const msg = parsed.error.issues?.[0]?.message || 'Datos inválidos';
        return NextResponse.json({ success: false, msg }, { status: 400 });
    }

    const {
        lote_id,
        piscina_id,
        fecha,
        tipo_alimento_id,
        cantidad,
        proveedor_id = null,
        nro_factura = null,
        valor_unitario,
        active,
    } = parsed.data;

    const valor_u = round3(Number(valor_unitario ?? 0));
    const total = round2((Number(cantidad) || 0) * valor_u);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const beforeRes = await client.query(`SELECT * FROM alimentos WHERE id=$1`, [id]);
        if (beforeRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Registro no encontrado' }, { status: 404 });
        }

        if (role !== 'SUPERADMIN') {
            const incluyeActive = active !== undefined;
            const ok = await operadorTienePaseRecienteEnTablaSolicitudes(
                user.id,
                'alimentaciones',
                id,
                incluyeActive ? 'solicitudes_inactivacion' : 'solicitudes_edicion',
                10
            );
            if (!ok) {
                await client.query('ROLLBACK');
                return NextResponse.json({
                    success: false,
                    msg: incluyeActive
                        ? 'No autorizado: requiere código válido reciente de inactivación/restauración.'
                        : 'No autorizado: requiere código válido reciente de edición.',
                }, { status: 403 });
            }
        }

        const updSql = `
        UPDATE alimentos
        SET lote_id=$1, piscina_id=$2, fecha=$3, tipo_alimento_id=$4, cantidad=$5,
            proveedor_id=$6, nro_factura=$7, valor_unitario=$8, total=$9,
            editado_por=$10, editado_en=NOW(), active = COALESCE($11, active)
        WHERE id=$12
        RETURNING *
        `;
        const updVals = [
            lote_id,
            piscina_id,
            fecha,
            tipo_alimento_id,
            cantidad,
            proveedor_id,
            nro_factura,
            Number(Number(valor_u).toFixed(3)),
            total,
            user.id,
            active === undefined ? null : active,
            id,
        ];
        const updRes = await client.query(updSql, updVals);

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
        VALUES ($1,'alimentos',$2,$3::text,$4::jsonb)`,
            [user.id, id, 'UPDATE', JSON.stringify({ old: beforeRes.rows[0], new: updRes.rows[0] })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true, data: updRes.rows[0] });
    } catch (e: unknown) {
        await client.query('ROLLBACK');
        console.error('PUT /api/feedings/:id error', e);
        // Si el error tiene código PostgreSQL
        const pgError = e as { code?: string };
        if (pgError?.code === '23505') return NextResponse.json({ success: false, msg: 'Conflicto en datos (duplicado)' }, { status: 409 });
        return NextResponse.json({ success: false, msg: 'Error interno al actualizar registro' }, { status: 500 });
    } finally {
        client.release();
    }
}

/** * PATCH (parcial)
 * CORRECCIÓN CLAVE: El tipado del segundo argumento ahora es Next.js "nativo"
 */
export async function PATCH(
    req: NextRequest, 
    context: { params: RouteParams } 
) {
    const id = parseId(context.params?.id);
    if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    // Tipado más seguro para el usuario
    const user = auth as { id: number; role: string; };
    const role = (user.role ?? '').toString().toUpperCase();

    const json = await req.json().catch(() => ({}));
    const parsed = PatchFeedingSchema.safeParse(json);
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

        const beforeRes = await client.query(`SELECT * FROM alimentos WHERE id=$1`, [id]);
        if (beforeRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Registro no encontrado' }, { status: 404 });
        }

        if (role !== 'SUPERADMIN') {
            const incluyeActive = Object.prototype.hasOwnProperty.call(updates, 'active');
            const ok = await operadorTienePaseRecienteEnTablaSolicitudes(
                user.id,
                'alimentaciones',
                id,
                incluyeActive ? 'solicitudes_inactivacion' : 'solicitudes_edicion',
                10
            );
            if (!ok) {
                await client.query('ROLLBACK');
                return NextResponse.json({
                    success: false,
                    msg: incluyeActive
                        ? 'No autorizado: requiere código válido de inactivación/restauración.'
                        : 'No autorizado: requiere código válido de edición.',
                }, { status: 403 });
            }
        }

        // Recalcular campos dependientes
        const before = beforeRes.rows[0];
        // Usamos el índice de Updates si existe, sino el valor anterior
        const valorUnitarioNew = updates.valor_unitario !== undefined ? round3(Number(updates.valor_unitario ?? 0)) : before.valor_unitario;
        const cantidadNew = updates.cantidad !== undefined ? Number(updates.cantidad ?? 0) : before.cantidad;
        const totalNew = round2((Number(cantidadNew) || 0) * (Number(valorUnitarioNew) || 0));

        // Build SETs
        const sets: string[] = [];
        const vals: any[] = [];
        let idx = 1;
        const allowed = ['lote_id','piscina_id','fecha','tipo_alimento_id','cantidad','proveedor_id','nro_factura','valor_unitario','active'];

        // Iteración segura sobre las claves
        for (const key of Object.keys(updates)) {
            if (!allowed.includes(key)) continue;
            sets.push(`${key} = $${idx++}`);
            // @ts-expect-error key is guaranteed to be in updates and allowed
            vals.push(updates[key]);
        }

        // set total, editado_por, editado_en
        sets.push(`total = $${idx++}`); vals.push(totalNew);
        sets.push(`editado_por = $${idx++}`); vals.push(user.id);
        sets.push(`editado_en = NOW()`); // no param

        // final WHERE param (id)
        vals.push(id);

        const sql = `UPDATE alimentos SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`;
        const updRes = await client.query(sql, vals);

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
        VALUES ($1,'alimentos',$2,$3::text,$4::jsonb)`,
            [user.id, id, 'UPDATE', JSON.stringify({ old: beforeRes.rows[0], new: updRes.rows[0] })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true, data: updRes.rows[0] });
    } catch (e: unknown) {
        await client.query('ROLLBACK');
        console.error('PATCH /api/feedings/:id error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al actualizar registro' }, { status: 500 });
    } finally {
        client.release();
    }
}

/** * DELETE (soft) 
 * CORRECCIÓN CLAVE: El tipado del segundo argumento ahora es Next.js "nativo"
 */
export async function DELETE(
    req: NextRequest, 
    context: { params: RouteParams } 
) {
    const id = parseId(context.params?.id);
    if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    // Tipado más seguro para el usuario
    const user = auth as { id: number; role: string; };
    const role = (user.role ?? '').toString().toUpperCase();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const beforeRes = await client.query(`SELECT * FROM alimentos WHERE id=$1`, [id]);
        if (beforeRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Registro no encontrado' }, { status: 404 });
        }

        if (role !== 'SUPERADMIN') {
            const ok = await operadorTienePaseRecienteEnTablaSolicitudes(
                user.id,
                'alimentaciones',
                id,
                'solicitudes_inactivacion',
                10
            );
            if (!ok) {
                await client.query('ROLLBACK');
                return NextResponse.json({ success: false, msg: 'No autorizado: requiere código válido reciente de inactivación.' }, { status: 403 });
            }
        }

        await client.query(
            `UPDATE alimentos SET active = FALSE, editado_por = $1, editado_en = NOW() WHERE id=$2`,
            [user.id, id]
        );

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
        VALUES ($1,'alimentos',$2,$3::text,$4::jsonb)`,
            [user.id, id, 'DELETE', JSON.stringify({ old: beforeRes.rows[0], soft_delete: true })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        await client.query('ROLLBACK');
        console.error('DELETE /api/feedings/:id error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al eliminar registro' }, { status: 500 });
    } finally {
        client.release();
    }
}
