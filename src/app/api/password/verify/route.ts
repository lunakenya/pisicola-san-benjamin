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
    const { email, code } = await req.json().catch(() => ({}));
    const cleanEmail = (email || '').toString().trim().toLowerCase();
    const codeStr = (code || '').toString().trim();

    const generic = NextResponse.json({ success: false, msg: 'Código inválido o expirado' }, { status: 400 });
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || !/^\d{6}$/.test(codeStr)) {
        return generic;
    }

    const ip = getClientIP(req);
    const ua = getUserAgent(req);

    const client = await pool.connect();
    try {
        const r = await client.query(
            `SELECT id, user_id, email, code_hash, expires_at
         FROM password_resets
        WHERE LOWER(email)=LOWER($1) AND active=TRUE AND used=FALSE
        ORDER BY created_at DESC
        LIMIT 1`,
            [cleanEmail]
        );
        if (r.rowCount === 0) return generic;

        const row = r.rows[0];

        if (row.expires_at && new Date() > new Date(row.expires_at)) {
            await client.query(
                `UPDATE password_resets
            SET active=FALSE, closed_at=NOW(), close_reason='expired'
          WHERE id=$1 AND active=TRUE`,
                [row.id]
            );
            return generic;
        }

        const ok = await bcrypt.compare(codeStr, row.code_hash);
        if (!ok) return generic;

        const token = jwt.sign(
            { t: 'pw_reset', rid: row.id, uid: row.user_id, email: row.email },
            process.env.JWT_SECRET as string,
            { expiresIn: '10m' }
        );

        await client.query(
            `UPDATE password_resets
          SET active=FALSE, closed_at=NOW(), close_reason='verified',
              verified_ip=$2, verified_user_agent=$3
        WHERE id=$1 AND active=TRUE`,
            [row.id, ip, ua]
        );

        const res = NextResponse.json({ success: true });
        res.cookies.set({
            name: 'pw_reset',
            value: token,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 60 * 10,
        });
        return res;
    } catch (e) {
        console.error('POST /api/password/verify error', e);
        return NextResponse.json({ success: false, msg: 'Error interno' }, { status: 500 });
    } finally {
        client.release();
    }
}
