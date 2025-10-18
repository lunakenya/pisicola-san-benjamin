// src/app/api/details/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DetailSchema = z.object({
    nombre: z.string().min(1, 'Nombre requerido').max(100),
});

// GET /api/details?q=&page=&pageSize=&includeInactive=
export async function GET(req: NextRequest) {
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const pageSize = Math.max(1, Math.min(500, Number(searchParams.get('pageSize') || 50)));
    const includeInactive = (searchParams.get('includeInactive') || 'false').toLowerCase() === 'true';
    const offset = (page - 1) * pageSize;

    const baseWhere = includeInactive ? 'WHERE 1=1' : 'WHERE d.active = TRUE';
    const where = q.length > 0 ? `${baseWhere} AND (d.nombre ILIKE $1)` : baseWhere;

    const params: any[] = [];
    if (q.length > 0) params.push(`%${q}%`);

    const countSql = `SELECT COUNT(*) AS total FROM detalles_presentacion d ${where}`;
    const dataSql = `
        SELECT d.id, d.nombre, d.active
        FROM detalles_presentacion d
            ${where}
        ORDER BY d.id DESC
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
        console.error('GET details error', e);
        return NextResponse.json({ success: false, msg: 'Internal error' }, { status: 500 });
    } finally {
        client.release();
    }
}

// POST /api/details
export async function POST(req: NextRequest) {
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    const json = await req.json();
    const parsed = DetailSchema.safeParse(json);
    if (!parsed.success) {
        return NextResponse.json({ success: false, msg: parsed.error.issues[0].message }, { status: 400 });
    }
    const { nombre } = parsed.data;

    const client = await pool.connect();
    try {
        const conflictActive = await client.query(
            `SELECT id FROM detalles_presentacion WHERE active = TRUE AND LOWER(nombre) = LOWER($1) LIMIT 1`,
            [nombre.trim()]
        );
        if (conflictActive.rowCount > 0) {
            return NextResponse.json({ success: false, msg: 'Nombre ya existe (activo).' }, { status: 409 });
        }

        const conflictInactive = await client.query(
            `SELECT id FROM detalles_presentacion WHERE active = FALSE AND LOWER(nombre) = LOWER($1) LIMIT 1`,
            [nombre.trim()]
        );
        if (conflictInactive.rowCount > 0) {
            return NextResponse.json({ success: false, msg: 'Nombre existe inactivo. Considere restaurarlo.' }, { status: 409 });
        }

        await client.query('BEGIN');

        const ins = await client.query(
            `INSERT INTO detalles_presentacion (nombre, active) VALUES ($1, TRUE) RETURNING id, nombre, active`,
            [nombre.trim()]
        );

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'detalles_presentacion',$2,'INSERT',$3::jsonb)`,
            [user.id, ins.rows[0].id, JSON.stringify({ new: ins.rows[0] })]
        );

        await client.query('COMMIT');

        return NextResponse.json({ success: true, data: ins.rows[0] }, { status: 201 });
    } catch (e: any) {
        await client.query('ROLLBACK');
        if (e?.code === '23505') {
            return NextResponse.json({ success: false, msg: 'Nombre ya existe (activo).' }, { status: 409 });
        }
        console.error('POST details error', e);
        return NextResponse.json({ success: false, msg: 'Internal error' }, { status: 500 });
    } finally {
        client.release();
    }
}
