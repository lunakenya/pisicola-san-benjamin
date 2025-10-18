// src/app/api/losses/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const CreateLossSchema = z.object({
    lote_id: z.number().int().nullable(),
    piscina_id: z.number().int().nullable(),
    fecha: z
        .string()
        .min(1, 'La fecha es requerida (formato YYYY-MM-DD)')
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (YYYY-MM-DD)'),
    muertos: z.number().int().min(0, 'Muertos debe ser >= 0').optional().default(0),
    faltantes: z.number().int().min(0, 'Faltantes debe ser >= 0').optional().default(0),
    sobrantes: z.number().int().min(0, 'Sobrantes debe ser >= 0').optional().default(0),
    deformes: z.number().int().min(0, 'Deformes debe ser >= 0').optional().default(0),
});

// GET /api/losses
export async function GET(req: NextRequest) {
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    // --- NUEVO: Capturar fechas desde los parámetros ---
    const desde = searchParams.get('desde') || '';
    const hasta = searchParams.get('hasta') || '';
    const includeInactive = (searchParams.get('includeInactive') || 'false').toLowerCase() === 'true';
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const pageSize = Math.max(1, Math.min(200, Number(searchParams.get('pageSize') || 50)));
    const offset = (page - 1) * pageSize;

    let baseWhere = 'WHERE 1=1';
    const params: any[] = [];

    if (!includeInactive) {
        baseWhere += ` AND b.active = TRUE`;
    }

    // --- NUEVO: Aplicar filtro de fechas a la consulta ---
    if (desde) {
        params.push(desde);
        baseWhere += ` AND b.fecha >= $${params.length}`;
    }
    if (hasta) {
        params.push(hasta);
        baseWhere += ` AND b.fecha <= $${params.length}`;
    }

    if (q.length > 0) {
        params.push(`%${q}%`);
        // Búsqueda extendida para incluir valores numéricos
        const numericQ = parseInt(q.replace(/\D/g, ''));
        const hasNumeric = !isNaN(numericQ);

        let searchCondition = `(l.nombre ILIKE $${params.length} OR p.nombre ILIKE $${params.length}`;
        if (hasNumeric) {
            searchCondition += ` OR b.muertos = ${numericQ} OR b.faltantes = ${numericQ} OR b.sobrantes = ${numericQ} OR b.deformes = ${numericQ}`;
        }
        searchCondition += ')';
        baseWhere += ` AND ${searchCondition}`;
    }

    const countSql = `SELECT COUNT(*) AS total FROM bajas b LEFT JOIN lotes l ON l.id=b.lote_id LEFT JOIN piscinas p ON p.id=b.piscina_id ${baseWhere}`;
    const dataSql = `
        SELECT b.*, l.nombre AS lote_nombre, p.nombre AS piscina_nombre
        FROM bajas b
                 LEFT JOIN lotes l ON l.id = b.lote_id
                 LEFT JOIN piscinas p ON p.id = b.piscina_id
            ${baseWhere}
        ORDER BY b.fecha DESC, b.id DESC
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
            pages: Math.ceil(total / pageSize),
        });
    } catch (e) {
        console.error('GET /api/losses error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al obtener bajas' }, { status: 500 });
    } finally {
        client.release();
    }
}

// POST /api/losses (crear)
export async function POST(req: NextRequest) {
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    const json = await req.json().catch(() => ({}));
    const parsed = CreateLossSchema.safeParse(json);
    if (!parsed.success) {
        const msg = parsed.error.issues?.[0]?.message || 'Datos inválidos';
        return NextResponse.json({ success: false, msg }, { status: 400 });
    }

    const { lote_id, piscina_id, fecha, muertos, faltantes, sobrantes, deformes } = parsed.data;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insSql = `
            INSERT INTO bajas (lote_id, piscina_id, fecha, muertos, faltantes, sobrantes, deformes, creado_por, creado_en, active)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(), TRUE)
                RETURNING *
        `;
        const insVals = [lote_id, piscina_id, fecha, muertos, faltantes, sobrantes, deformes, user.id];
        const ins = await client.query(insSql, insVals);

        // Registrar auditoría
        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'bajas',$2,'INSERT',$3::jsonb)`,
            [user.id, ins.rows[0].id, JSON.stringify({ new: ins.rows[0] })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true, data: ins.rows[0] }, { status: 201 });
    } catch (e: any) {
        await client.query('ROLLBACK');
        console.error('POST /api/losses error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al crear baja' }, { status: 500 });
    } finally {
        client.release();
    }
}