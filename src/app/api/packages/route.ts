// src/app/api/packages/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PackageSchema = z.object({
    nombre: z.string().min(1, 'Nombre requerido').max(100),
});

// GET /api/packages?q=&page=&pageSize=&includeInactive=
export async function GET(req: NextRequest) {
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const pageSize = Math.max(1, Math.min(500, Number(searchParams.get('pageSize') || 50)));
    const includeInactive = (searchParams.get('includeInactive') || 'false').toLowerCase() === 'true';
    const offset = (page - 1) * pageSize;

    const baseWhere = includeInactive ? 'WHERE 1=1' : 'WHERE p.active = TRUE';
    const where = q.length > 0 ? `${baseWhere} AND (p.nombre ILIKE $1)` : baseWhere;

    const params: any[] = [];
    if (q.length > 0) params.push(`%${q}%`);

    const countSql = `SELECT COUNT(*) AS total FROM tipos_paquete p ${where}`;
    const dataSql = `
        SELECT p.id, p.nombre, p.active
        FROM tipos_paquete p
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
        console.error('GET packages error', e);
        return NextResponse.json({ success: false, msg: 'Internal error' }, { status: 500 });
    } finally {
        client.release();
    }
}

// POST /api/packages
export async function POST(req: NextRequest) {
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    const json = await req.json();
    const parsed = PackageSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ success: false, msg: parsed.error.issues[0].message }, { status: 400 });
    const { nombre } = parsed.data;

    const client = await pool.connect();
    try {
        const conflictActive = await client.query(
            `SELECT id FROM tipos_paquete WHERE active = TRUE AND LOWER(nombre) = LOWER($1) LIMIT 1`,
            [nombre.trim()]
        );
        if (conflictActive.rowCount > 0) {
            return NextResponse.json({ success: false, msg: 'Nombre ya existe (activo).' }, { status: 409 });
        }

        const conflictInactive = await client.query(
            `SELECT id FROM tipos_paquete WHERE active = FALSE AND LOWER(nombre) = LOWER($1) LIMIT 1`,
            [nombre.trim()]
        );
        if (conflictInactive.rowCount > 0) {
            return NextResponse.json({ success: false, msg: 'Nombre existe inactivo. Considere restaurarlo.' }, { status: 409 });
        }

        await client.query('BEGIN');

        const ins = await client.query(
            `INSERT INTO tipos_paquete (nombre, active) VALUES ($1, TRUE) RETURNING id, nombre, active`,
            [nombre.trim()]
        );

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'tipos_paquete',$2,'INSERT',$3::jsonb)`,
            [user.id, ins.rows[0].id, JSON.stringify({ new: ins.rows[0] })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true, data: ins.rows[0] }, { status: 201 });
    } catch (e: any) {
        await client.query('ROLLBACK');
        if (e?.code === '23505') {
            return NextResponse.json({ success: false, msg: 'Nombre ya existe (activo).' }, { status: 409 });
        }
        console.error('POST packages error', e);
        return NextResponse.json({ success: false, msg: 'Internal error' }, { status: 500 });
    } finally {
        client.release();
    }
}
