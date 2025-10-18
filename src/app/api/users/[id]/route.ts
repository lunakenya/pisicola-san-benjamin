// src/app/api/users/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const RoleEnum = z.enum(['SUPERADMIN','OPERADOR']);
const UpdateSchema = z.object({
    nombre: z.string().min(1,'Nombre requerido').max(150),
    email: z.string().email('Email inválido').max(150),
    rol: RoleEnum,
    password: z.string().min(6).optional(), // si viene, resetea
});
const PatchSchema = z.object({ active: z.boolean() });

async function countSuperadmins(client: any) {
    const r = await client.query(`SELECT COUNT(*) AS c FROM usuarios WHERE active=TRUE AND rol='SUPERADMIN'`);
    return Number(r.rows[0]?.c || 0);
}

// PUT /api/users/:id
export async function PUT(req: NextRequest, context: any) {
    const params = await context.params;
    const auth = requireAuthApi(req, ['SUPERADMIN']);
    if (auth instanceof NextResponse) return auth;
    const actor = auth as any;

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ success:false, msg:'Invalid id' }, { status:400 });

    const json = await req.json();
    const parsed = UpdateSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ success:false, msg: parsed.error.issues[0].message }, { status:400 });

    const { nombre, email, rol, password } = parsed.data;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const before = await client.query(`SELECT id, nombre, email, rol, active FROM usuarios WHERE id=$1`, [id]);
        if (before.rowCount === 0) { await client.query('ROLLBACK'); return NextResponse.json({ success:false, msg:'Not found' }, { status:404 }); }
        const prev = before.rows[0];

        // Conflicto email (otro activo)
        const conf = await client.query(`SELECT id FROM usuarios WHERE active=TRUE AND LOWER(email)=LOWER($1) AND id<>$2 LIMIT 1`, [email.trim(), id]);
        if (conf.rowCount > 0) { await client.query('ROLLBACK'); return NextResponse.json({ success:false, msg:'Email ya está en uso.' }, { status:409 }); }

        // Si cambia rol de SUPERADMIN a OPERADOR, garantizar que quede al menos 1 SUPERADMIN activo
        if (prev.rol === 'SUPERADMIN' && rol !== 'SUPERADMIN') {
            const totalSup = await countSuperadmins(client);
            if (totalSup <= 1) { await client.query('ROLLBACK'); return NextResponse.json({ success:false, msg:'No puedes dejar el sistema sin SUPERADMIN.' }, { status:400 }); }
        }

        // Build update
        let upd;
        if (password) {
            const hash = await bcrypt.hash(password, 10);
            upd = await client.query(
                `UPDATE usuarios SET nombre=$1, email=$2, rol=$3, password_hash=$4 WHERE id=$5
           RETURNING id, nombre, email, rol, active`,
                [nombre.trim(), email.trim(), rol, hash, id]
            );
        } else {
            upd = await client.query(
                `UPDATE usuarios SET nombre=$1, email=$2, rol=$3 WHERE id=$4
           RETURNING id, nombre, email, rol, active`,
                [nombre.trim(), email.trim(), rol, id]
            );
        }

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
         VALUES ($1,'usuarios',$2,'UPDATE',$3::jsonb)`,
            [actor.id, id, JSON.stringify({ old: prev, new: upd.rows[0], resetPass: !!password })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success:true, data: upd.rows[0] });
    } catch (e:any) {
        await client.query('ROLLBACK');
        console.error('PUT users error', e);
        return NextResponse.json({ success:false, msg:'Internal error' }, { status:500 });
    } finally {
        client.release();
    }
}

// DELETE /api/users/:id  (soft delete)
export async function DELETE(req: NextRequest, context: any) {
    const params = await context.params;
    const auth = requireAuthApi(req, ['SUPERADMIN']);
    if (auth instanceof NextResponse) return auth;
    const actor = auth as any;

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ success:false, msg:'Invalid id' }, { status:400 });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const before = await client.query(`SELECT id, nombre, email, rol, active FROM usuarios WHERE id=$1`, [id]);
        if (before.rowCount === 0) { await client.query('ROLLBACK'); return NextResponse.json({ success:false, msg:'Not found' }, { status:404 }); }
        const prev = before.rows[0];

        if (!prev.active) { await client.query('ROLLBACK'); return NextResponse.json({ success:false, msg:'Ya está inactivo' }, { status:400 }); }
        if (prev.id === actor.id) { await client.query('ROLLBACK'); return NextResponse.json({ success:false, msg:'No puedes inactivarte a ti mismo.' }, { status:400 }); }
        if (prev.rol === 'SUPERADMIN') {
            const totalSup = await countSuperadmins(client);
            if (totalSup <= 1) { await client.query('ROLLBACK'); return NextResponse.json({ success:false, msg:'No puedes inactivar al último SUPERADMIN.' }, { status:400 }); }
        }

        await client.query(`UPDATE usuarios SET active=FALSE WHERE id=$1`, [id]);

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
         VALUES ($1,'usuarios',$2,'DELETE',$3::jsonb)`,
            [actor.id, id, JSON.stringify({ old: prev, soft_delete: true })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success:true });
    } catch (e:any) {
        await client.query('ROLLBACK');
        console.error('DELETE users error', e);
        return NextResponse.json({ success:false, msg:'Internal error' }, { status:500 });
    } finally { client.release(); }
}

// PATCH /api/users/:id  (restaurar active)
export async function PATCH(req: NextRequest, context: any) {
    const params = await context.params;
    const auth = requireAuthApi(req, ['SUPERADMIN']);
    if (auth instanceof NextResponse) return auth;
    const actor = auth as any;

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ success:false, msg:'Invalid id' }, { status:400 });

    const json = await req.json();
    const parsed = PatchSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ success:false, msg: parsed.error.issues[0].message }, { status:400 });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const before = await client.query(`SELECT id, nombre, email, rol, active FROM usuarios WHERE id=$1`, [id]);
        if (before.rowCount === 0) { await client.query('ROLLBACK'); return NextResponse.json({ success:false, msg:'Not found' }, { status:404 }); }
        const prev = before.rows[0];

        if (parsed.data.active === true) {
            // email no puede chocar con otro activo
            const c = await client.query(`SELECT id FROM usuarios WHERE active=TRUE AND LOWER(email)=LOWER($1) AND id<>$2 LIMIT 1`, [prev.email, id]);
            if (c.rowCount > 0) { await client.query('ROLLBACK'); return NextResponse.json({ success:false, msg:'Email en uso por otro activo.' }, { status:409 }); }
        }

        const upd = await client.query(
            `UPDATE usuarios SET active=$1 WHERE id=$2 RETURNING id, nombre, email, rol, active`,
            [parsed.data.active, id]
        );

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
         VALUES ($1,'usuarios',$2,'UPDATE',$3::jsonb)`,
            [actor.id, id, JSON.stringify({ old: prev, new: upd.rows[0] })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success:true, data: upd.rows[0] });
    } catch (e:any) {
        await client.query('ROLLBACK');
        console.error('PATCH users error', e);
        return NextResponse.json({ success:false, msg:'Internal error' }, { status:500 });
    } finally { client.release(); }
}
