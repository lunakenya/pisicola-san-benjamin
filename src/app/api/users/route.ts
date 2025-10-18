// src/app/api/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const RoleEnum = z.enum(['SUPERADMIN','OPERADOR']);
const CreateUserSchema = z.object({
    nombre: z.string().min(1,'Nombre requerido').max(150),
    email: z.string().email('Email inválido').max(150),
    password: z.string().min(6,'Contraseña muy corta'),
    rol: RoleEnum
});

// GET /api/users?q=&page=&pageSize=&includeInactive=
export async function GET(req: NextRequest) {
    const auth = requireAuthApi(req, ['SUPERADMIN']); // solo superadmin ve/gestiona usuarios
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const pageSize = Math.max(1, Math.min(100, Number(searchParams.get('pageSize') || 10)));
    const includeInactive = (searchParams.get('includeInactive') || 'false').toLowerCase() === 'true';
    const offset = (page - 1) * pageSize;

    const baseWhere = includeInactive ? 'WHERE 1=1' : 'WHERE u.active = TRUE';
    const where = q ? `${baseWhere} AND (u.nombre ILIKE $1 OR u.email ILIKE $1)` : baseWhere;

    const params: any[] = [];
    if (q) params.push(`%${q}%`);

    const countSql = `SELECT COUNT(*) AS total FROM usuarios u ${where}`;
    const dataSql = `
    SELECT u.id, u.nombre, u.email, u.rol, u.active
      FROM usuarios u
      ${where}
      ORDER BY u.id DESC
      LIMIT $${params.length+1} OFFSET $${params.length+2}
  `;

    const client = await pool.connect();
    try {
        const totalRes = await client.query(countSql, params);
        const total = Number(totalRes.rows[0]?.total || 0);

        const dataRes = await client.query(dataSql, [...params, pageSize, offset]);
        return NextResponse.json({
            success: true, data: dataRes.rows, page, pageSize, total, pages: Math.ceil(total / pageSize),
        });
    } catch (e) {
        console.error('GET users error', e);
        return NextResponse.json({ success:false, msg:'Internal error' }, { status:500 });
    } finally {
        client.release();
    }
}

// POST /api/users  (create)
export async function POST(req: NextRequest) {
    const auth = requireAuthApi(req, ['SUPERADMIN']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    const json = await req.json();
    const parsed = CreateUserSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ success:false, msg: parsed.error.issues[0].message }, { status:400 });

    const { nombre, email, password, rol } = parsed.data;

    const client = await pool.connect();
    try {
        // conflictos email activo/inactivo
        const confAct = await client.query(`SELECT id FROM usuarios WHERE active=TRUE AND LOWER(email)=LOWER($1) LIMIT 1`, [email.trim()]);
        if (confAct.rowCount > 0) return NextResponse.json({ success:false, msg:'Email ya registrado (activo).' }, { status:409 });

        const confInact = await client.query(`SELECT id FROM usuarios WHERE active=FALSE AND LOWER(email)=LOWER($1) LIMIT 1`, [email.trim()]);
        if (confInact.rowCount > 0) return NextResponse.json({ success:false, msg:'Email existe inactivo. Considere restaurarlo.' }, { status:409 });

        await client.query('BEGIN');

        const password_hash = await bcrypt.hash(password, 10);
        const ins = await client.query(
            `INSERT INTO usuarios (nombre, email, password_hash, rol, active)
         VALUES ($1,$2,$3,$4,TRUE)
         RETURNING id, nombre, email, rol, active`,
            [nombre.trim(), email.trim(), password_hash, rol]
        );

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
         VALUES ($1,'usuarios',$2,'INSERT',$3::jsonb)`,
            [user.id, ins.rows[0].id, JSON.stringify({ new: ins.rows[0] })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success:true, data: ins.rows[0] }, { status:201 });
    } catch (e:any) {
        await client.query('ROLLBACK');
        console.error('POST users error', e);
        return NextResponse.json({ success:false, msg:'Internal error' }, { status:500 });
    } finally {
        client.release();
    }
}
