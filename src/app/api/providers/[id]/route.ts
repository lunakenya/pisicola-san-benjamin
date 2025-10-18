// src/app/api/providers/[id]/route.ts
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
const PatchSchema = z.object({
    active: z.boolean(),
});

// PUT /api/providers/:id  (editar)
export async function PUT(req: NextRequest, context: any) {
    const params = await context.params;
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ success: false, msg: 'Invalid id' }, { status: 400 });

    const json = await req.json();
    const parsed = ProviderSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ success: false, msg: parsed.error.issues[0].message }, { status: 400 });
    const { nombre, ruc } = parsed.data;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const before = await client.query(`SELECT id, nombre, ruc, active FROM proveedores WHERE id=$1`, [id]);
        if (before.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Not found' }, { status: 404 });
        }

        const conflictSqlParts: string[] = [];
        const conflictParams: any[] = [];
        conflictParams.push(nombre.trim());
        conflictSqlParts.push(`LOWER(nombre) = LOWER($1)`);
        if (ruc) {
            conflictParams.push(ruc.trim());
            conflictSqlParts.push(`ruc = $${conflictParams.length}`);
        }
        const conflictSql = `
            SELECT id FROM proveedores
            WHERE active = TRUE AND (${conflictSqlParts.join(' OR ')})
              AND id != $${conflictParams.length + 1}
                LIMIT 1
        `;
        conflictParams.push(id);
        const c = await client.query(conflictSql, conflictParams);
        if (c.rowCount > 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Nombre o RUC en uso por otro Proveedor.' }, { status: 409 });
        }

        const upd = await client.query(
            `UPDATE proveedores
             SET nombre=$1, ruc=$2
             WHERE id=$3
                 RETURNING id, nombre, ruc, active`,
            [nombre.trim(), ruc ? ruc.trim() : null, id]
        );

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'proveedores',$2,'UPDATE',$3::jsonb)`,
            [user.id, id, JSON.stringify({ old: before.rows[0], new: upd.rows[0] })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true, data: upd.rows[0] });
    } catch (e: any) {
        await client.query('ROLLBACK');
        if (e?.code === '23505') {
            return NextResponse.json({ success: false, msg: 'Nombre ya existe (activo).' }, { status: 409 });
        }
        console.error('PUT providers error', e);
        return NextResponse.json({ success: false, msg: 'Internal error' }, { status: 500 });
    } finally {
        client.release();
    }
}

// DELETE /api/providers/:id  (soft delete)
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

        const before = await client.query(`SELECT id, nombre, ruc, active FROM proveedores WHERE id=$1`, [id]);
        if (before.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Not found' }, { status: 404 });
        }

        await client.query(`UPDATE proveedores SET active=FALSE WHERE id=$1`, [id]);

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'proveedores',$2,'DELETE',$3::jsonb)`,
            [user.id, id, JSON.stringify({ old: before.rows[0], soft_delete: true })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('DELETE providers error', e);
        return NextResponse.json({ success: false, msg: 'Internal error' }, { status: 500 });
    } finally {
        client.release();
    }
}

// PATCH /api/providers/:id
export async function PATCH(req: NextRequest, context: any) {
    const params = await context.params;
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ success: false, msg: 'Invalid id' }, { status: 400 });

    const json = await req.json();
    const PatchSchema = z.object({ active: z.boolean() });
    const parsed = PatchSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ success: false, msg: parsed.error.issues[0].message }, { status: 400 });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const before = await client.query(`SELECT id, nombre, ruc, active FROM proveedores WHERE id=$1`, [id]);
        if (before.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Not found' }, { status: 404 });
        }

        if (parsed.data.active === true) {
            const { nombre, ruc } = before.rows[0];
            const conflictSql = `
                SELECT id FROM proveedores
                WHERE active = TRUE AND (LOWER(nombre)=LOWER($1) ${ruc ? ' OR ruc = $2' : ''})
                  AND id != $${ruc ? 3 : 2}
                    LIMIT 1
            `;
            const confParams = ruc ? [nombre, ruc, id] : [nombre, id];
            const conf = await client.query(conflictSql, confParams);
            if (conf.rowCount > 0) {
                await client.query('ROLLBACK');
                return NextResponse.json({ success: false, msg: 'Nombre o RUC en uso por otro activo.' }, { status: 409 });
            }
        }

        const upd = await client.query(
            `UPDATE proveedores SET active=$1 WHERE id=$2
                RETURNING id, nombre, ruc, active`,
            [parsed.data.active, id]
        );

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'proveedores',$2,'UPDATE',$3::jsonb)`,
            [user.id, id, JSON.stringify({ old: before.rows[0], new: upd.rows[0] })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true, data: upd.rows[0] });
    } catch (e: any) {
        await client.query('ROLLBACK');
        if (e?.code === '23505') {
            return NextResponse.json({ success: false, msg: 'Nombre en uso por otro activo.' }, { status: 409 });
        }
        console.error('PATCH providers error', e);
        return NextResponse.json({ success: false, msg: 'Internal error' }, { status: 500 });
    } finally {
        client.release();
    }
}
