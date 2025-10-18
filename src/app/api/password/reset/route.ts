import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function getClientIP(req: NextRequest) {
    const xff = req.headers.get('x-forwarded-for') || '';
    if (xff) return xff.split(',')[0].trim();
    return (req.headers.get('x-real-ip') || '').trim() || '0.0.0.0';
}
function getUserAgent(req: NextRequest) {
    return (req.headers.get('user-agent') || '').slice(0, 500);
}

export async function POST(req: NextRequest) {
    const cookie = req.cookies.get('pw_reset')?.value || '';
    if (!cookie) return NextResponse.json({ success: false, msg: 'Sesión de reset no válida' }, { status: 401 });

    let payload: any;
    try {
        payload = jwt.verify(cookie, process.env.JWT_SECRET as string);
        if (payload?.t !== 'pw_reset' || !payload?.uid || !payload?.rid) throw new Error('bad');
    } catch {
        return NextResponse.json({ success: false, msg: 'Sesión de reset inválida o expirada' }, { status: 401 });
    }

    const { password } = await req.json().catch(() => ({}));
    const pass = (password || '').toString().trim();
    if (pass.length < 6) {
        return NextResponse.json({ success: false, msg: 'Contraseña mínima de 6 caracteres' }, { status: 400 });
    }

    const ip = getClientIP(req);
    const ua = getUserAgent(req);
    const hash = await bcrypt.hash(pass, 10);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const chk = await client.query(
            `SELECT id, user_id, email, expires_at, used
         FROM password_resets
        WHERE id=$1 AND user_id=$2 AND used=FALSE`,
            [payload.rid, payload.uid]
        );
        if (chk.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Enlace inválido o ya utilizado' }, { status: 400 });
        }

        const row = chk.rows[0];
        if (row.expires_at && new Date() > new Date(row.expires_at)) {
            await client.query(
                `UPDATE password_resets
            SET active=FALSE, closed_at=NOW(), close_reason='expired'
          WHERE id=$1`,
                [row.id]
            );
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Código expirado' }, { status: 400 });
        }

        await client.query(
            `UPDATE usuarios
          SET password_hash=$1, actualizado_en=NOW()
        WHERE id=$2`,
            [hash, payload.uid]
        );

        await client.query(
            `UPDATE password_resets
          SET used=TRUE, used_at=NOW(), active=FALSE,
              used_ip=$2, used_user_agent=$3,
              closed_at=COALESCE(closed_at, NOW()),
              close_reason=COALESCE(close_reason, 'used')
        WHERE id=$1`,
            [payload.rid, ip, ua]
        );

        await client.query('COMMIT');
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch {}
        console.error('POST /api/password/reset error', e);
        return NextResponse.json({ success: false, msg: 'Error interno' }, { status: 500 });
    } finally {
        client.release();
    }

    const res = NextResponse.json({ success: true });
    res.cookies.set({ name: 'pw_reset', value: '', path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
    return res;
}
