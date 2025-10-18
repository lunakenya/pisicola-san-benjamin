// src/app/api/pools/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PoolSchema = z.object({
    nombre: z.string().min(1, 'Nombre requerido').max(100),
});
const PatchSchema = z.object({
    active: z.boolean(),
});

// PUT /api/pools/:id
export async function PUT(req: NextRequest, context: any) {
    const params = await context.params;
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ success: false, msg: 'Invalid id' }, { status: 400 });

    const json = await req.json();
    const parsed = PoolSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ success: false, msg: parsed.error.issues[0].message }, { status: 400 });
    const { nombre } = parsed.data;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const before = await client.query(`SELECT id, nombre, active FROM piscinas WHERE id=$1`, [id]);
        if (before.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Not found' }, { status: 404 });
        }

        const conflict = await client.query(
            `SELECT id FROM piscinas WHERE active = TRUE AND LOWER(nombre) = LOWER($1) AND id != $2 LIMIT 1`,
            [nombre.trim(), id]
        );
        if (conflict.rowCount > 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Nombre ya existe (activo).' }, { status: 409 });
        }

        const upd = await client.query(
            `UPDATE piscinas SET nombre=$1 WHERE id=$2 RETURNING id, nombre, active`,
            [nombre.trim(), id]
        );

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'piscinas',$2,'UPDATE',$3::jsonb)`,
            [user.id, id, JSON.stringify({ old: before.rows[0], new: upd.rows[0] })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true, data: upd.rows[0] });
    } catch (e: any) {
        await client.query('ROLLBACK');
        if (e?.code === '23505') {
            return NextResponse.json({ success: false, msg: 'Nombre ya existe (activo).' }, { status: 409 });
        }
        console.error('PUT pools error', e);
        return NextResponse.json({ success: false, msg: 'Internal error' }, { status: 500 });
    } finally {
        client.release();
    }
}

// DELETE /api/pools/:id (soft delete)
export async function DELETE(req: NextRequest, context: any) {
    const params = await context.params;
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ success: false, msg: 'Invalid id' }, { status: 400 });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const before = await client.query(`SELECT id, nombre, active FROM piscinas WHERE id=$1`, [id]);
        if (before.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Not found' }, { status: 404 });
        }

        await client.query(`UPDATE piscinas SET active=FALSE WHERE id=$1`, [id]);

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'piscinas',$2,'DELETE',$3::jsonb)`,
            [user.id, id, JSON.stringify({ old: before.rows[0], soft_delete: true })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('DELETE pools error', e);
        return NextResponse.json({ success: false, msg: 'Internal error' }, { status: 500 });
    } finally {
        client.release();
    }
}

// PATCH /api/pools/:id  (restore active=true/false)
export async function PATCH(req: NextRequest, context: any) {
    const params = await context.params;
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ success: false, msg: 'Invalid id' }, { status: 400 });

    const json = await req.json();
    const parsed = PatchSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ success: false, msg: parsed.error.issues[0].message }, { status: 400 });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const before = await client.query(`SELECT id, nombre, active FROM piscinas WHERE id=$1`, [id]);
        if (before.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Not found' }, { status: 404 });
        }

        if (parsed.data.active === true) {
            const { nombre } = before.rows[0];
            const conf = await client.query(
                `SELECT id FROM piscinas WHERE active = TRUE AND LOWER(nombre) = LOWER($1) AND id != $2 LIMIT 1`,
                [nombre, id]
            );
            if (conf.rowCount > 0) {
                await client.query('ROLLBACK');
                return NextResponse.json({ success: false, msg: 'Nombre ya en uso por otro activo.' }, { status: 409 });
            }
        }

        const upd = await client.query(
            `UPDATE piscinas SET active=$1 WHERE id=$2 RETURNING id, nombre, active`,
            [parsed.data.active, id]
        );

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'piscinas',$2,'UPDATE',$3::jsonb)`,
            [user.id, id, JSON.stringify({ old: before.rows[0], new: upd.rows[0] })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true, data: upd.rows[0] });
    } catch (e: any) {
        await client.query('ROLLBACK');
        if (e?.code === '23505') {
            return NextResponse.json({ success: false, msg: 'Nombre en uso por otro activo.' }, { status: 409 });
        }
        console.error('PATCH pools error', e);
        return NextResponse.json({ success: false, msg: 'Internal error' }, { status: 500 });
    } finally {
        client.release();
    }
}
