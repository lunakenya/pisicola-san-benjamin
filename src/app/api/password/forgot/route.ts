import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function makeTransporter() {
    if (!process.env.SMTP_HOST) return null;
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
}
function getClientIP(req: NextRequest) {
    const xff = req.headers.get('x-forwarded-for') || '';
    if (xff) return xff.split(',')[0].trim();
    return (req.headers.get('x-real-ip') || '').trim() || '0.0.0.0';
}
function getUserAgent(req: NextRequest) {
    return (req.headers.get('user-agent') || '').slice(0, 500);
}

function buildResetEmail(opts: { nombre: string; code: string; expiresAt: Date }) {
    const formatted = new Date(opts.expiresAt).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' });
    const digits = opts.code.split('');
    const brandPrimary = '#0f8b44';
    const brandDark = '#0b6633';
    const lightBg = '#f5f7fa';
    const textDark = '#0a2540';
    const textMuted = '#5a6b7c';
    const border = '#e2e8f0';
    const logoUrl = 'https://raw.githubusercontent.com/ChristopherPalloArias/Logos/master/logo.png';

    return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width"/>
<title>Código de recuperación</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=Roboto+Mono:wght@700&display=swap');</style>
</head>
<body style="margin:0;padding:0;background:${lightBg};font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${lightBg};padding:40px 20px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${border}">
<tr>
  <td style="background:linear-gradient(135deg,${brandPrimary},${brandDark});padding:24px 24px 28px 24px">
    <img src="${logoUrl}" width="90" height="90" alt="Logo" style="display:block;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,.25)"/>
    <h1 style="margin:12px 0 0 0;color:#fff;font-size:22px">Código de recuperación</h1>
    <p style="margin:6px 0 0 0;color:rgba(255,255,255,.9);font-size:14px">Hola ${opts.nombre || 'usuario'}, usa este código para restablecer tu contraseña.</p>
  </td>
</tr>
<tr>
  <td style="padding:28px;color:${textDark}">
    <div style="text-align:center;margin:0 0 16px">Tu código (6 dígitos):</div>
    <div style="text-align:center;margin-bottom:24px">
      ${digits.map(d => `
        <div style="display:inline-block;width:52px;height:74px;margin:0 4px;background:#111;border:1px solid #333;border-radius:10px;
                    box-shadow:0 4px 14px rgba(0,0,0,.3);">
          <span style="display:block;line-height:74px;font-family:'Roboto Mono',monospace;font-weight:700;font-size:40px;color:#00ff7b;
                       text-shadow:0 0 10px rgba(0,255,123,.6),0 0 18px rgba(0,255,123,.3)">${d}</span>
        </div>`).join('')}
    </div>
    <div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:10px;padding:12px 14px;margin-bottom:18px;color:#78350f">
      Válido hasta: <strong>${formatted}</strong>
    </div>
    <p style="color:${textMuted};font-size:12px;text-align:center;margin:0">Este correo se generó automáticamente. No respondas a este mensaje.</p>
  </td>
</tr>
<tr>
  <td style="background:#f8fafc;border-top:1px solid ${border};padding:16px;text-align:center;color:#94a3b8;font-size:11px">
    Piscícola San Benjamín · © ${new Date().getFullYear()}
  </td>
</tr>
</table>
</td></tr></table>
</body></html>`;
}

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const cleanEmail = (body?.email || '').toString().trim().toLowerCase();
    // Para no revelar si existe o no
    if (!cleanEmail) return NextResponse.json({ success: true });

    const ip = getClientIP(req);
    const ua = getUserAgent(req);

    const client = await pool.connect();
    try {
        const u = await client.query(
            `SELECT id, nombre, email
         FROM usuarios
        WHERE LOWER(email)=LOWER($1) AND COALESCE(active, TRUE)=TRUE
        LIMIT 1`,
            [cleanEmail]
        );
        if (u.rowCount === 0) return NextResponse.json({ success: true });

        const user = u.rows[0];
        const plain = String(Math.floor(100000 + Math.random() * 900000));
        const hash = await bcrypt.hash(plain, 10);
        const ttlMin = Number(process.env.PASSWORD_RESET_TTL_MIN || 30);
        const expires = new Date(Date.now() + ttlMin * 60 * 1000);

        await client.query('BEGIN');
        await client.query(
            `UPDATE password_resets
          SET active=FALSE, closed_at=NOW(), close_reason='superseded'
        WHERE email=$1 AND active=TRUE AND used=FALSE`,
            [user.email]
        );
        const ins = await client.query(
            `INSERT INTO password_resets
         (user_id, email, code_hash, created_at, expires_at, active, used, ip_address, user_agent)
       VALUES ($1,$2,$3,NOW(),$4,TRUE,FALSE,$5,$6)
       RETURNING id`,
            [user.id, user.email, hash, expires, ip, ua]
        );
        await client.query('COMMIT');

        const transporter = makeTransporter();
        const html = buildResetEmail({ nombre: user.nombre || user.email, code: plain, expiresAt: expires });

        if (transporter) {
            try {
                await transporter.sendMail({
                    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@example.com',
                    to: user.email,
                    subject: 'Código de recuperación de contraseña',
                    html,
                });
                console.log(`[forgot] mail OK -> reset_id=${ins.rows[0].id} to=${user.email}`);
            } catch (e) {
                console.error('[forgot] SMTP error:', e);
            }
        } else {
            console.log(`(DEV) Código para ${user.email}: ${plain}`);
        }

        return NextResponse.json({ success: true });
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch {}
        console.error('[forgot] DB error:', e);
        return NextResponse.json({ success: true }); // anti-enumeración
    } finally {
        client.release();
    }
}
