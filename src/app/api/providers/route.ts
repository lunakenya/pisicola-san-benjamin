// src/app/api/providers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ProviderSchema = z.object({
    nombre: z.string().min(1, 'Nombre requerido').max(150),
    ruc: z
        .string()
        .trim()
        .max(20, 'RUC demasiado largo')
        .regex(/^\d*$/, 'RUC sólo debe contener números')
        .optional()
        .or(z.literal('')),
});

// GET /api/providers?q=&page=&pageSize=&includeInactive=
export async function GET(req: NextRequest) {
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const pageSize = Math.max(1, Math.min(100, Number(searchParams.get('pageSize') || 10)));
    const includeInactive = (searchParams.get('includeInactive') || 'false').toLowerCase() === 'true';
    const offset = (page - 1) * pageSize;

    const baseWhere = includeInactive ? 'WHERE 1=1' : 'WHERE p.active = TRUE';
    const where = q.length > 0 ? `${baseWhere} AND (p.nombre ILIKE $1 OR COALESCE(p.ruc,'') ILIKE $1)` : baseWhere;

    const params: any[] = [];
    if (q.length > 0) params.push(`%${q}%`);

    const countSql = `SELECT COUNT(*) AS total FROM proveedores p ${where}`;
    const dataSql = `
        SELECT p.id, p.nombre, p.ruc, p.active
        FROM proveedores p
            ${where}
        ORDER BY p.id DESC
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
        console.error('GET providers error', e);
        return NextResponse.json({ success: false, msg: 'Internal error' }, { status: 500 });
    } finally {
        client.release();
    }
}

// POST /api/providers (create)
export async function POST(req: NextRequest) {
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    const json = await req.json();
    const parsed = ProviderSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ success: false, msg: parsed.error.issues[0].message }, { status: 400 });

    const { nombre, ruc } = parsed.data;

    const client = await pool.connect();
    try {
        const conflictQ = `
            SELECT id FROM proveedores
            WHERE active = TRUE AND (LOWER(nombre) = LOWER($1) ${ruc ? ' OR ruc = $2' : ''})
                LIMIT 1
        `;
        const conflictParams = ruc ? [nombre.trim(), ruc.trim()] : [nombre.trim()];
        const conf = await client.query(conflictQ, conflictParams);
        if (conf.rowCount > 0) {
            return NextResponse.json({ success: false, msg: 'Nombre o RUC ya existe en un registro activo.' }, { status: 409 });
        }

        const inactiveQ = `
            SELECT id FROM proveedores
            WHERE active = FALSE AND (LOWER(nombre) = LOWER($1) ${ruc ? ' OR ruc = $2' : ''})
                LIMIT 1
        `;
        const inc = await client.query(inactiveQ, conflictParams);
        if (inc.rowCount > 0) {
            return NextResponse.json({ success: false, msg: 'Nombre existe inactivo. Considere restaurarlo.' }, { status: 409 });
        }

        await client.query('BEGIN');

        const ins = await client.query(
            `INSERT INTO proveedores (nombre, ruc, active)
             VALUES ($1, $2, TRUE)
                 RETURNING id, nombre, ruc, active`,
            [nombre.trim(), ruc ? ruc.trim() : null]
        );

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'proveedores',$2,'INSERT',$3::jsonb)`,
            [user.id, ins.rows[0].id, JSON.stringify({ new: ins.rows[0] })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true, data: ins.rows[0] }, { status: 201 });
    } catch (e: any) {
        await client.query('ROLLBACK');
        if (e?.code === '23505') {
            return NextResponse.json({ success: false, msg: 'Nombre ya existe (activo).' }, { status: 409 });
        }
        console.error('POST providers error', e);
        return NextResponse.json({ success: false, msg: 'Internal error' }, { status: 500 });
    } finally {
        client.release();
    }
}
