// src/app/api/feedings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const CreateFeedingSchema = z.object({
    fecha: z
        .string()
        .min(1, 'La fecha es requerida (formato YYYY-MM-DD)')
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (YYYY-MM-DD)'),
    lote_id: z.number().int().nullable(),
    piscina_id: z.number().int().nullable(),
    tipo_alimento_id: z.number().int().nullable(),
    cantidad: z.number().min(0, 'Cantidad debe ser >= 0'),
    proveedor_id: z.number().int().nullable().optional(),
    nro_factura: z.string().trim().nullable().optional(),
    valor_unitario: z.number().min(0).optional().default(0),
    active: z.boolean().optional(),
});

function round3(v: number) { return Math.round(v * 1000) / 1000; }
function round2(v: number) { return Math.round(v * 100) / 100; }
/* computeMes está disponible si la necesitas para lógica cliente/servicio,
   pero **no** se debe escribir en la BD. */
function computeMes(fecha: string): number | null {
    const d = new Date(`${fecha}T12:00:00Z`);
    if (isNaN(d.getTime())) return null;
    return d.getMonth() + 1;
}

export async function GET(req: NextRequest) {
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const desde = searchParams.get('desde') || '';
    const hasta = searchParams.get('hasta') || '';
    const includeInactive = (searchParams.get('includeInactive') || 'false').toLowerCase() === 'true';
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const pageSize = Math.max(1, Math.min(200, Number(searchParams.get('pageSize') || 50)));
    const offset = (page - 1) * pageSize;

    let baseWhere = 'WHERE 1=1';
    const params: any[] = [];

    if (!includeInactive) baseWhere += ' AND a.active = TRUE';

    if (desde) {
        params.push(desde);
        baseWhere += ` AND a.fecha >= $${params.length}`;
    }
    if (hasta) {
        params.push(hasta);
        baseWhere += ` AND a.fecha <= $${params.length}`;
    }

    if (q.length > 0) {
        params.push(`%${q}%`);
        const numericQ = parseInt(q.replace(/\D/g, ''), 10);
        const hasNumeric = !isNaN(numericQ);
        let cond = `(l.nombre ILIKE $${params.length} OR p.nombre ILIKE $${params.length} OR t.nombre ILIKE $${params.length}`;
        if (hasNumeric) {
            cond += ` OR a.cantidad = ${numericQ} OR a.valor_unitario = ${numericQ}`;
        }
        cond += ')';
        baseWhere += ` AND ${cond}`;
    }

    const countSql = `SELECT COUNT(*) AS total
                      FROM alimentos a
                               LEFT JOIN lotes l ON l.id = a.lote_id
                               LEFT JOIN piscinas p ON p.id = a.piscina_id
                               LEFT JOIN tipos_alimento t ON t.id = a.tipo_alimento_id
                          ${baseWhere}`;

    const dataSql = `
        SELECT a.*, l.nombre AS lote_nombre, p.nombre AS piscina_nombre, t.nombre AS tipo_alimento_nombre, pr.nombre AS proveedor_nombre
        FROM alimentos a
                 LEFT JOIN lotes l ON l.id = a.lote_id
                 LEFT JOIN piscinas p ON p.id = a.piscina_id
                 LEFT JOIN tipos_alimento t ON t.id = a.tipo_alimento_id
                 LEFT JOIN proveedores pr ON pr.id = a.proveedor_id
            ${baseWhere}
        ORDER BY a.fecha DESC, a.id DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const client = await pool.connect();
    try {
        const totalRes = await client.query(countSql, params);
        const total = Number(totalRes.rows[0]?.total || 0);
        const dataRes = await client.query(dataSql, [...params, pageSize, offset]);

        return NextResponse.json({
            success: true,
            data: dataRes.rows,
            page,
            pageSize,
            total,
            pages: Math.max(1, Math.ceil(total / pageSize)),
        });
    } catch (e) {
        console.error('GET /api/feedings error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al obtener alimentaciones' }, { status: 500 });
    } finally {
        client.release();
    }
}

export async function POST(req: NextRequest) {
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    const json = await req.json().catch(() => ({}));
    const parsed = CreateFeedingSchema.safeParse(json);
    if (!parsed.success) {
        const msg = parsed.error.issues?.[0]?.message || 'Datos inválidos';
        return NextResponse.json({ success: false, msg }, { status: 400 });
    }

    const {
        fecha,
        lote_id,
        piscina_id,
        tipo_alimento_id,
        cantidad,
        proveedor_id = null,
        nro_factura = null,
        valor_unitario = 0,
        active,
    } = parsed.data;

    const valor_u = round3(Number(valor_unitario ?? 0));
    const total = round2((Number(cantidad) || 0) * valor_u);
    // NO escribir `mes` (columna generada en DB)

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insertSql = `
            INSERT INTO alimentos
            (lote_id, piscina_id, fecha, tipo_alimento_id, cantidad, proveedor_id, nro_factura, valor_unitario, total, creado_por, creado_en, active)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(), COALESCE($11, TRUE))
                RETURNING *
        `;
        const vals = [
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
        ];

        const ins = await client.query(insertSql, vals);

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1, 'alimentos', $2, 'INSERT', $3::jsonb)`,
            [user.id, ins.rows[0].id, JSON.stringify({ new: ins.rows[0] })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true, data: ins.rows[0] }, { status: 201 });
    } catch (e: any) {
        await client.query('ROLLBACK');
        console.error('POST /api/feedings error', e);
        if (e?.code === '23505') return NextResponse.json({ success: false, msg: 'Conflicto (duplicado)' }, { status: 409 });
        return NextResponse.json({ success: false, msg: 'Error interno al crear alimentación' }, { status: 500 });
    } finally {
        client.release();
    }
}
