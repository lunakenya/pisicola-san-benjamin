// src/app/api/feedings/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

function parseId(param: string | undefined): number | null {
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

/* ------------------------------------------------------ */
/* ---------------------- GET ---------------------------- */
/* ------------------------------------------------------ */
export async function GET(req: NextRequest, context: { params: { id: string } }) {
  const id = parseId(context.params.id);
  if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

  const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
  if (auth instanceof NextResponse) return auth;

  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT a.*, l.nombre AS lote_nombre, p.nombre AS piscina_nombre, 
              t.nombre AS tipo_alimento_nombre, pr.nombre AS proveedor_nombre
       FROM alimentos a
       LEFT JOIN lotes l ON l.id = a.lote_id
       LEFT JOIN piscinas p ON p.id = a.piscina_id
       LEFT JOIN tipos_alimento t ON t.id = a.tipo_alimento_id
       LEFT JOIN proveedores pr ON pr.id = a.proveedor_id
       WHERE a.id = $1`,
      [id]
    );

    if (r.rowCount === 0)
      return NextResponse.json({ success: false, msg: 'No encontrado' }, { status: 404 });

    return NextResponse.json({ success: true, data: r.rows[0] });
  } catch (e) {
    console.error('GET /api/feedings/:id error', e);
    return NextResponse.json({ success: false, msg: 'Error interno al obtener registro' }, { status: 500 });
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------ */
/* ---------------------- PUT ---------------------------- */
/* ------------------------------------------------------ */
export async function PUT(req: NextRequest, context: { params: { id: string } }) {
  const id = parseId(context.params.id);
  if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

  const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
  if (auth instanceof NextResponse) return auth;
  const user = auth as { id: number; role: string };
  const role = (user.role ?? '').toUpperCase();

  const json = await req.json().catch(() => ({}));
  const parsed = PutFeedingSchema.safeParse(json);
  if (!parsed.success)
    return NextResponse.json({ success: false, msg: parsed.error.issues[0]?.message || 'Datos inválidos' }, { status: 400 });

  const { lote_id, piscina_id, fecha, tipo_alimento_id, cantidad, proveedor_id = null, nro_factura = null, valor_unitario, active } = parsed.data;

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

    const updRes = await client.query(
      `UPDATE alimentos
       SET lote_id=$1, piscina_id=$2, fecha=$3, tipo_alimento_id=$4, cantidad=$5,
           proveedor_id=$6, nro_factura=$7, valor_unitario=$8, total=$9,
           editado_por=$10, editado_en=NOW(), active=COALESCE($11, active)
       WHERE id=$12 RETURNING *`,
      [lote_id, piscina_id, fecha, tipo_alimento_id, cantidad, proveedor_id, nro_factura, valor_u, total, user.id, active ?? null, id]
    );

    await client.query(
      `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
       VALUES ($1,'alimentos',$2,'UPDATE',$3::jsonb)`,
      [user.id, id, JSON.stringify({ old: beforeRes.rows[0], new: updRes.rows[0] })]
    );

    await client.query('COMMIT');
    return NextResponse.json({ success: true, data: updRes.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('PUT /api/feedings/:id error', e);
    return NextResponse.json({ success: false, msg: 'Error interno al actualizar registro' }, { status: 500 });
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------ */
/* ---------------------- PATCH -------------------------- */
/* ------------------------------------------------------ */
export async function PATCH(req: NextRequest, context: { params: { id: string } }) {
  const id = parseId(context.params.id);
  if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

  const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
  if (auth instanceof NextResponse) return auth;
  const user = auth as { id: number; role: string };
  const role = (user.role ?? '').toUpperCase();

  const json = await req.json().catch(() => ({}));
  const parsed = PatchFeedingSchema.safeParse(json);
  if (!parsed.success)
    return NextResponse.json({ success: false, msg: parsed.error.issues[0]?.message || 'Datos inválidos' }, { status: 400 });

  const updates = parsed.data;
  if (Object.keys(updates).length === 0)
    return NextResponse.json({ success: false, msg: 'No hay campos para actualizar' }, { status: 400 });

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

    const before = beforeRes.rows[0];
    const valorUnitarioNew = updates.valor_unitario !== undefined ? round3(Number(updates.valor_unitario ?? 0)) : before.valor_unitario;
    const cantidadNew = updates.cantidad !== undefined ? Number(updates.cantidad ?? 0) : before.cantidad;
    const totalNew = round2((Number(cantidadNew) || 0) * (Number(valorUnitarioNew) || 0));

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    const allowed = ['lote_id', 'piscina_id', 'fecha', 'tipo_alimento_id', 'cantidad', 'proveedor_id', 'nro_factura', 'valor_unitario', 'active'];

    for (const key of Object.keys(updates)) {
      if (!allowed.includes(key)) continue;
      // @ts-ignore
      sets.push(`${key} = $${idx++}`);
      // @ts-ignore
      vals.push(updates[key]);
    }

    sets.push(`total = $${idx++}`); vals.push(totalNew);
    sets.push(`editado_por = $${idx++}`); vals.push(user.id);
    sets.push(`editado_en = NOW()`); // timestamp directo
    vals.push(id);

    const sql = `UPDATE alimentos SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`;
    const updRes = await client.query(sql, vals);

    await client.query(
      `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
       VALUES ($1,'alimentos',$2,'UPDATE',$3::jsonb)`,
      [user.id, id, JSON.stringify({ old: beforeRes.rows[0], new: updRes.rows[0] })]
    );

    await client.query('COMMIT');
    return NextResponse.json({ success: true, data: updRes.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('PATCH /api/feedings/:id error', e);
    return NextResponse.json({ success: false, msg: 'Error interno al actualizar registro' }, { status: 500 });
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------ */
/* ---------------------- DELETE ------------------------- */
/* ------------------------------------------------------ */
export async function DELETE(req: NextRequest, context: { params: { id: string } }) {
  const id = parseId(context.params.id);
  if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

  const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
  if (auth instanceof NextResponse) return auth;
  const user = auth as { id: number; role: string };
  const role = (user.role ?? '').toUpperCase();

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
       VALUES ($1,'alimentos',$2,'DELETE',$3::jsonb)`,
      [user.id, id, JSON.stringify({ old: beforeRes.rows[0], soft_delete: true })]
    );

    await client.query('COMMIT');
    return NextResponse.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('DELETE /api/feedings/:id error', e);
    return NextResponse.json({ success: false, msg: 'Error interno al eliminar registro' }, { status: 500 });
  } finally {
    client.release();
  }
}
