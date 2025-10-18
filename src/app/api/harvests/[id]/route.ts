import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function parseId(param: any) {
    const id = Number(param);
    if (!Number.isInteger(id) || id <= 0) return null;
    return id;
}

function round3(v: number) { return Math.round(v * 1000) / 1000; }
function round0(v: number) { return Math.round(v); }

/** Revisa si el operador tiene un pase reciente (código usado) para la tabla de solicitudes. */
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

/** Helper: extraer campo flexible (acepta tanto nombres en inglés como en español) */
function pickField<T = any>(body: any, english: string, spanish: string, fallback?: T): T {
    if (body == null) return fallback as T;
    if (Object.prototype.hasOwnProperty.call(body, english)) return body[english];
    if (Object.prototype.hasOwnProperty.call(body, spanish)) return body[spanish];
    return fallback as T;
}

/** GET single harvest */
export async function GET(req: NextRequest, context: any) {
    const params = await context.params;
    const id = parseId(params?.id);
    if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;

    const client = await pool.connect();
    try {
        const r = await client.query(
            `SELECT c.*,
                    l.id AS lote_id, l.nombre AS lote_nombre, l.nombre AS lot_name,
                    p.id AS piscina_id, p.nombre AS piscina_nombre, p.nombre AS pond_name,
                    dp.id AS detalle_id, dp.nombre AS detalle_nombre, dp.nombre AS detail_name,
                    tp.id AS tipo_paquete_id, tp.nombre AS tipo_paquete_nombre, tp.nombre AS package_count_label
             FROM cosechas c
                      LEFT JOIN lotes l ON l.id = c.lote_id
                      LEFT JOIN piscinas p ON p.id = c.piscina_id
                      LEFT JOIN detalles_presentacion dp ON dp.id = c.detalle_id
                      LEFT JOIN tipos_paquete tp ON tp.id = c.tipo_paquete_id
             WHERE c.id = $1`,
            [id]
        );
        if (r.rowCount === 0) return NextResponse.json({ success: false, msg: 'No encontrado' }, { status: 404 });

        const row = r.rows[0];
        // Normalizaciones / aliases para frontend
        const payload = {
            ...row,
            id: row.id,
            date: row.fecha, // frontend espera "date"
            // counts / labels
            lot_id: row.lote_id,
            lot_name: row.lot_name ?? row.lote_nombre,
            pond_id: row.piscina_id,
            pond_name: row.pond_name ?? row.piscina_nombre,
            detail_id: row.detalle_id ?? row.detalle_id,
            detail_name: row.detail_name ?? row.detalle_nombre,
            // paquetes / tipo paquete
            package_count_id: row.tipo_paquete_id ?? null,
            package_count_label: row.package_count_label ?? row.tipo_paquete_nombre ?? null,
            // trout and sheet
            trout_count: Number(row.num_truchas ?? row.trout_count ?? 0),
            sheet_number: row.nro_hoja_cosecha ?? row.sheet_number ?? null,
            // kilos: keep numeric and also as "kilos_text" (frontend tolera ambos)
            kilos: row.kilos != null ? Number(row.kilos) : null,
            kilos_text: row.kilos != null ? Number(row.kilos) : null,
            // preserve spanish names for compatibility
            lote_nombre: row.lote_nombre,
            piscina_nombre: row.piscina_nombre,
            detalle_nombre: row.detalle_nombre,
            tipo_paquete_nombre: row.tipo_paquete_nombre,
            active: row.active,
            created_by: row.creado_por,
            created_at: row.creado_en,
            updated_by: row.editado_por,
            updated_at: row.editado_en,
        };
        return NextResponse.json({ success: true, data: payload });
    } catch (e) {
        console.error('GET /api/harvests/:id error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al obtener cosecha' }, { status: 500 });
    } finally {
        client.release();
    }
}

/** PUT (reemplazo completo) */
export async function PUT(req: NextRequest, context: any) {
    const params = await context.params;
    const id = parseId(params?.id);
    if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;
    const role = (user.role ?? '').toString().toUpperCase();

    const json = await req.json().catch(() => ({}));

    // Map flexible fields (inglés / español)
    const lote_id = pickField<number | null>(json, 'lot_id', 'lote_id', null);
    const piscina_id = pickField<number | null>(json, 'pond_id', 'piscina_id', null);
    const fecha = pickField<string>(json, 'date', 'fecha', '');
    const num_truchas = pickField<number>(json, 'trout_count', 'num_truchas', 0);
    const nro_hoja_cosecha = pickField<string | null>(json, 'sheet_number', 'nro_hoja_cosecha', null);
    const kilos_in = pickField<any>(json, 'kilos_text', 'kilos', json.kilos ?? json.kilos_text ?? null);
    const paquetes_in = pickField<number | null>(json, 'paquetes', 'paquetes', json.paquetes ?? null);
    const tipo_paquete_id = pickField<number | null>(json, 'package_count_id', 'tipo_paquete_id', null);
    const detalle_id = pickField<number | null>(json, 'detail_id', 'detalle_id', null);
    const active = pickField<boolean | undefined>(json, 'active', 'active', undefined);

    // Basic validations
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return NextResponse.json({ success: false, msg: 'Fecha inválida. Formato YYYY-MM-DD' }, { status: 400 });
    }
    if (!Number.isFinite(Number(num_truchas)) || Number(num_truchas) < 0) {
        return NextResponse.json({ success: false, msg: 'num_truchas inválido' }, { status: 400 });
    }
    const kilosVal = kilos_in == null ? 0 : Number(String(kilos_in).toString().replace(',', '.')) ;
    if (kilos_in != null && (!Number.isFinite(Number(kilosVal)) || Number(kilosVal) < 0)) {
        return NextResponse.json({ success: false, msg: 'kilos inválido' }, { status: 400 });
    }

    const kilosR = round3(Number(kilosVal ?? 0));
    const paquetesR = paquetes_in != null ? round0(Number(paquetes_in)) : null;
    const numTruchasR = round0(Number(num_truchas ?? 0));

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const beforeRes = await client.query(`SELECT * FROM cosechas WHERE id=$1`, [id]);
        if (beforeRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Registro no encontrado' }, { status: 404 });
        }

        if (role !== 'SUPERADMIN') {
            const incluyeActive = active !== undefined;
            const ok = await operadorTienePaseRecienteEnTablaSolicitudes(
                user.id,
                'cosechas',
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
      UPDATE cosechas
      SET lote_id=$1, piscina_id=$2, fecha=$3, num_truchas=$4, nro_hoja_cosecha=$5,
          kilos=$6, paquetes=$7, tipo_paquete_id=$8, detalle_id=$9,
          editado_por=$10, editado_en=NOW(), active = COALESCE($11, active)
      WHERE id=$12
      RETURNING *
    `;
        const updVals = [
            lote_id,
            piscina_id,
            fecha,
            numTruchasR,
            nro_hoja_cosecha,
            Number(Number(kilosR).toFixed(3)),
            paquetesR,
            tipo_paquete_id,
            detalle_id,
            user.id,
            active === undefined ? null : active,
            id,
        ];
        const updRes = await client.query(updSql, updVals);

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
       VALUES ($1,'cosechas',$2,'UPDATE',$3::jsonb)`,
            [user.id, id, JSON.stringify({ old: beforeRes.rows[0], new: updRes.rows[0] })]
        );

        await client.query('COMMIT');

        // prepare response with aliases for frontend
        const row = updRes.rows[0];
        const payload = {
            ...row,
            date: row.fecha,
            lot_id: row.lote_id,
            lot_name: row.lote_nombre ?? null,
            pond_id: row.piscina_id,
            pond_name: row.piscina_nombre ?? null,
            detail_id: row.detalle_id,
            detail_name: row.detalle_nombre ?? null,
            package_count_id: row.tipo_paquete_id ?? null,
            package_count_label: row.tipo_paquete_nombre ?? null,
            trout_count: Number(row.num_truchas ?? 0),
            sheet_number: row.nro_hoja_cosecha ?? null,
            kilos: row.kilos != null ? Number(row.kilos) : null,
            kilos_text: row.kilos != null ? Number(row.kilos) : null,
        };

        return NextResponse.json({ success: true, data: payload });
    } catch (e: any) {
        await client.query('ROLLBACK');
        console.error('PUT /api/harvests/:id error', e);
        if (e?.code === '23505') return NextResponse.json({ success: false, msg: 'Conflicto en datos (duplicado)' }, { status: 409 });
        return NextResponse.json({ success: false, msg: 'Error interno al actualizar cosecha' }, { status: 500 });
    } finally {
        client.release();
    }
}

/** PATCH (parcial) */
export async function PATCH(req: NextRequest, context: any) {
    const params = await context.params;
    const id = parseId(params?.id);
    if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;
    const role = (user.role ?? '').toString().toUpperCase();

    const json = await req.json().catch(() => ({}));
    if (!json || Object.keys(json).length === 0) {
        return NextResponse.json({ success: false, msg: 'No hay campos para actualizar' }, { status: 400 });
    }

    // Map flexible incoming keys
    const incoming: any = {};
    if (Object.prototype.hasOwnProperty.call(json, 'lot_id')) incoming.lote_id = json.lot_id;
    if (Object.prototype.hasOwnProperty.call(json, 'lote_id')) incoming.lote_id = json.lote_id;
    if (Object.prototype.hasOwnProperty.call(json, 'pond_id')) incoming.piscina_id = json.pond_id;
    if (Object.prototype.hasOwnProperty.call(json, 'piscina_id')) incoming.piscina_id = json.piscina_id;
    if (Object.prototype.hasOwnProperty.call(json, 'date')) incoming.fecha = json.date;
    if (Object.prototype.hasOwnProperty.call(json, 'fecha')) incoming.fecha = json.fecha;
    if (Object.prototype.hasOwnProperty.call(json, 'trout_count')) incoming.num_truchas = json.trout_count;
    if (Object.prototype.hasOwnProperty.call(json, 'num_truchas')) incoming.num_truchas = json.num_truchas;
    if (Object.prototype.hasOwnProperty.call(json, 'sheet_number')) incoming.nro_hoja_cosecha = json.sheet_number;
    if (Object.prototype.hasOwnProperty.call(json, 'nro_hoja_cosecha')) incoming.nro_hoja_cosecha = json.nro_hoja_cosecha;
    if (Object.prototype.hasOwnProperty.call(json, 'kilos_text')) incoming.kilos = json.kilos_text;
    if (Object.prototype.hasOwnProperty.call(json, 'kilos')) incoming.kilos = json.kilos;
    if (Object.prototype.hasOwnProperty.call(json, 'paquetes')) incoming.paquetes = json.paquetes;
    if (Object.prototype.hasOwnProperty.call(json, 'tipo_paquete_id')) incoming.tipo_paquete_id = json.tipo_paquete_id;
    if (Object.prototype.hasOwnProperty.call(json, 'package_count_id')) incoming.tipo_paquete_id = json.package_count_id;
    if (Object.prototype.hasOwnProperty.call(json, 'detail_id')) incoming.detalle_id = json.detail_id;
    if (Object.prototype.hasOwnProperty.call(json, 'detalle_id')) incoming.detalle_id = json.detalle_id;
    if (Object.prototype.hasOwnProperty.call(json, 'active')) incoming.active = json.active;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const beforeRes = await client.query(`SELECT * FROM cosechas WHERE id=$1`, [id]);
        if (beforeRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Registro no encontrado' }, { status: 404 });
        }

        if (role !== 'SUPERADMIN') {
            const incluyeActive = Object.prototype.hasOwnProperty.call(incoming, 'active');
            const ok = await operadorTienePaseRecienteEnTablaSolicitudes(
                user.id,
                'cosechas',
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

        // Recalcular / normalizar si vienen ciertos campos
        const before = beforeRes.rows[0];
        const kilosNew = incoming.kilos !== undefined ? round3(Number(String(incoming.kilos).replace(',', '.'))) : before.kilos;
        const numTruchasNew = incoming.num_truchas !== undefined ? round0(Number(incoming.num_truchas)) : before.num_truchas;
        const paquetesNew = incoming.paquetes !== undefined ? round0(Number(incoming.paquetes)) : before.paquetes;

        // Build SETs dynamically
        const sets: string[] = [];
        const vals: any[] = [];
        let idx = 1;
        const allowed = ['lote_id','piscina_id','fecha','num_truchas','nro_hoja_cosecha','kilos','paquetes','tipo_paquete_id','detalle_id','active'];
        for (const key of Object.keys(incoming)) {
            if (!allowed.includes(key)) continue;
            sets.push(`${key} = $${idx++}`);
            vals.push(incoming[key] === null ? null : incoming[key]);
        }

        // ensure kilos / num_truchas / paquetes are normalized if they were provided
        // (if the client provided kilos as kilos_text, it was mapped to incoming.kilos above)
        // we already set incoming.kilos to the raw value; normalize if present in sets:
        const normalizedVals = sets.map((s, i) => {
            // nothing to do here: values are already set in vals above
            return null;
        });

        // add edit metadata
        sets.push(`editado_por = $${idx++}`); vals.push(user.id);
        sets.push(`editado_en = NOW()`);

        // final WHERE param
        vals.push(id);
        const sql = `UPDATE cosechas SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`;
        const updRes = await client.query(sql, vals);

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
       VALUES ($1,'cosechas',$2,'UPDATE',$3::jsonb)`,
            [user.id, id, JSON.stringify({ old: beforeRes.rows[0], new: updRes.rows[0] })]
        );

        await client.query('COMMIT');

        const row = updRes.rows[0];
        const payload = {
            ...row,
            date: row.fecha,
            lot_id: row.lote_id,
            lot_name: row.lote_nombre ?? null,
            pond_id: row.piscina_id,
            pond_name: row.piscina_nombre ?? null,
            detail_id: row.detalle_id,
            detail_name: row.detalle_nombre ?? null,
            package_count_id: row.tipo_paquete_id ?? null,
            package_count_label: row.tipo_paquete_nombre ?? null,
            trout_count: Number(row.num_truchas ?? 0),
            sheet_number: row.nro_hoja_cosecha ?? null,
            kilos: row.kilos != null ? Number(row.kilos) : null,
            kilos_text: row.kilos != null ? Number(row.kilos) : null,
        };

        return NextResponse.json({ success: true, data: payload });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('PATCH /api/harvests/:id error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al actualizar cosecha' }, { status: 500 });
    } finally {
        client.release();
    }
}

/** DELETE (soft) */
export async function DELETE(req: NextRequest, context: any) {
    const params = await context.params;
    const id = parseId(params?.id);
    if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;
    const role = (user.role ?? '').toString().toUpperCase();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const beforeRes = await client.query(`SELECT * FROM cosechas WHERE id=$1`, [id]);
        if (beforeRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Registro no encontrado' }, { status: 404 });
        }

        if (role !== 'SUPERADMIN') {
            const ok = await operadorTienePaseRecienteEnTablaSolicitudes(
                user.id,
                'cosechas',
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
            `UPDATE cosechas SET active = FALSE, editado_por = $1, editado_en = NOW() WHERE id=$2`,
            [user.id, id]
        );

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'cosechas',$2,'DELETE',$3::jsonb)`,
            [user.id, id, JSON.stringify({ old: beforeRes.rows[0], soft_delete: true })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('DELETE /api/harvests/:id error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al eliminar cosecha' }, { status: 500 });
    } finally {
        client.release();
    }
}
