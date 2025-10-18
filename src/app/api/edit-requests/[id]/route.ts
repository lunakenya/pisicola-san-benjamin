// src/app/api/edit-requests/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// SMTP (si no hay config, solo log)
function makeTransporter() {
    if (!process.env.SMTP_HOST) return null;
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
}

/** Email HTML con código de autorización (mantengo tu template original) */
function buildAuthCodeEmail(opts: {
    operadorNombre: string;
    solicitudId: number;
    tabla: string;
    registroId: number;
    codigo: string;
    expiresAt: Date;
    aprobadoPor: string;
    appUrl: string;
}) {
    const { operadorNombre, solicitudId, codigo, expiresAt, aprobadoPor } = opts;

    const brandPrimary = '#0f8b44';
    const brandDark = '#0b6633';
    const lightBg = '#f5f7fa';
    const textDark = '#0a2540';
    const textMuted = '#5a6b7c';
    const border = '#e2e8f0';

    const logoUrl = 'https://raw.githubusercontent.com/ChristopherPalloArias/Logos/master/logo.png';

    const formattedExpiry = new Date(expiresAt).toLocaleString('es-EC', {
        dateStyle: 'medium',
        timeStyle: 'short',
    });

    const digits = codigo.split('');

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width"/>
  <title>Solicitud aprobada - Código de autorización</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Roboto+Mono:wght@700&display=swap');
  </style>
</head>
<body style="margin:0;padding:0;background:${lightBg};font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${lightBg};padding:40px 20px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${border}">
        <tr>
          <td style="background:linear-gradient(135deg,${brandPrimary},${brandDark});padding:24px 24px 28px 24px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle">
                  <img src="${logoUrl}" width="120" height="120" alt="Logo" style="display:block;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.25)"/>
                </td>
                <td align="right" style="vertical-align:top">
                  <table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-block;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);border-radius:12px;padding:10px 14px;min-width:180px">
                    <tr><td style="font-size:10px;color:#fff;letter-spacing:.8px;text-transform:uppercase;font-weight:700;text-align:right">Solicitud</td></tr>
                    <tr><td style="color:#fff;font-size:22px;font-weight:800;letter-spacing:.5px;text-align:right">#${solicitudId}</td></tr>
                  </table>
                </td>
              </tr>
            </table>
            <h1 style="margin:16px 0 0 0;color:#fff;font-size:24px;letter-spacing:-.2px">Código de autorización disponible</h1>
            <p style="margin:6px 0 0 0;color:rgba(255,255,255,.9);font-size:14px">Aprobado por <strong>${aprobadoPor}</strong></p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 28px 8px 28px;color:${textDark}">
            <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6">Hola ${operadorNombre},</p>
            <p style="margin:0 0 24px 0;font-size:15px;line-height:1.7;color:${textMuted}">
              Usa el siguiente código de autorización para realizar la edición. Es de un solo uso y expira automáticamente.
            </p>
            <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
              <tr>
                <td align="center" style="font-size:0;line-height:0;padding:12px 0;">
                  ${digits.map(d => `
                    <div style="display:inline-block; vertical-align:top; width:56px; height:80px; margin:0 5px; background-color:#1a1a1a; border-radius:10px; border:1px solid #333; box-shadow:0 4px 15px rgba(0,0,0,.3); text-align:center;">
                      <span style="display:block; color:#00ff00; font-family:'Roboto Mono','Courier New',monospace; font-size:44px; font-weight:700; line-height:80px; text-shadow:0 0 10px rgba(0,255,0,0.6), 0 0 20px rgba(0,255,0,0.3);">
                        ${d}
                      </span>
                    </div>
                  `).join('')}
                </td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#fff7ed,#fffbeb);border:1px solid #f59e0b;border-radius:12px;padding:16px 16px 14px 16px;margin-bottom:24px">
              <tr>
                <td style="vertical-align:middle;padding-right:10px;width:28px">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="9" stroke="#d97706" stroke-width="2"/>
                    <path d="M12 7v5l4 2" stroke="#d97706" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                </td>
                <td style="vertical-align:middle">
                  <div style="font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:#92400e;font-weight:700;margin-bottom:4px">Código válido hasta</div>
                  <div style="font-size:16px;color:#78350f;font-weight:800">${formattedExpiry}</div>
                </td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2ff;border:1px solid #3b82f6;border-radius:12px;padding:14px 16px;margin-bottom:24px">
              <tr>
                <td style="vertical-align:top;padding-right:10px;width:24px">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </td>
                <td style="font-size:13px;line-height:1.6;color:#1e3a8a">
                  Ingresa al sistema, ubica el registro a editar y escribe el código cuando se solicite.
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px 0;color:${textMuted};font-size:12px;text-align:center">
              Este correo fue generado automáticamente. No respondas a este mensaje.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;border-top:1px solid ${border};padding:18px;text-align:center;color:#94a3b8;font-size:11px">
            Piscícola San Benjamín · © ${new Date().getFullYear()} Todos los derechos reservados
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Email HTML para notificar rechazo (mantengo tu template) */
function buildRejectEmail(opts: {
    operadorNombre: string;
    solicitudId: number;
    tabla: string;
    motivoOriginal: string;
    rechazadoPor: string;
    comentarioAdmin?: string;
}) {
    const { operadorNombre, solicitudId, tabla, motivoOriginal, rechazadoPor, comentarioAdmin } = opts;
    const brandPrimary = '#dc2626';
    const brandDark = '#991b1b';
    const lightBg = '#f5f7fa';
    const textDark = '#0a2540';
    const textMuted = '#5a6b7c';
    const border = '#e2e8f0';
    const logoUrl = 'https://raw.githubusercontent.com/ChristopherPalloArias/Logos/master/logo.png';

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width"/>
  <title>Solicitud Rechazada</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
  </style>
</head>
<body style="margin:0;padding:0;background:${lightBg};font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${lightBg};padding:40px 20px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${border}">
        <tr>
          <td style="background:linear-gradient(135deg,${brandPrimary},${brandDark});padding:24px 24px 28px 24px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle">
                  <img src="${logoUrl}" width="120" height="120" alt="Logo" style="display:block;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.25)"/>
                </td>
                <td align="right" style="vertical-align:top">
                  <table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-block;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);border-radius:12px;padding:10px 14px;min-width:180px">
                    <tr><td style="font-size:10px;color:#fff;letter-spacing:.8px;text-transform:uppercase;font-weight:700;text-align:right">Solicitud</td></tr>
                    <tr><td style="color:#fff;font-size:22px;font-weight:800;letter-spacing:.5px;text-align:right">#${solicitudId}</td></tr>
                  </table>
                </td>
              </tr>
            </table>
            <h1 style="margin:16px 0 0 0;color:#fff;font-size:24px;letter-spacing:-.2px">Solicitud Rechazada</h1>
            <p style="margin:6px 0 0 0;color:rgba(255,255,255,.9);font-size:14px">Revisada por <strong>${rechazadoPor}</strong></p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 28px;color:${textDark}">
            <p style="margin:0 0 16px;font-size:15px;line-height:1.6">Hola ${operadorNombre},</p>
            <p style="margin:0 0 24px;font-size:15px;color:${textMuted}">Tu solicitud para editar un registro de la tabla <strong>"${tabla}"</strong> ha sido rechazada.</p>
            <div style="background:#f8fafc;border-left:4px solid #cbd5e1;padding:16px;border-radius:8px;margin-bottom:24px">
              <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:${textMuted};text-transform:uppercase;letter-spacing:0.5px;">Tu motivo original:</p>
              <p style="margin:0;color:${textDark};font-size:14px;white-space:pre-wrap;line-height:1.6;">${motivoOriginal}</p>
            </div>
            ${comentarioAdmin ? `
            <div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:16px;border-radius:8px;margin-bottom:24px">
              <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;">Comentario del administrador:</p>
              <p style="margin:0;color:${textDark};font-size:14px;white-space:pre-wrap;line-height:1.6;">${comentarioAdmin}</p>
            </div>` : ''}
            <p style="margin:0 0 8px;font-size:13px;color:${textMuted}">Si crees que se trata de un error, puedes crear una nueva solicitud con más detalles desde el sistema.</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;border-top:1px solid ${border};padding:18px;text-align:center;color:#94a3b8;font-size:11px">
            Piscícola San Benjamín · © ${new Date().getFullYear()} Todos los derechos reservados
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function parseId(param: any) {
    const id = Number(param);
    if (!Number.isInteger(id) || id <= 0) return null;
    return id;
}

// PATCH: approve | reject (SUPERADMIN)
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }   // params asíncronos
) {
    const { id: idStr } = await params;
    const id = parseId(idStr);
    if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

    const auth = requireAuthApi(req, ['SUPERADMIN']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    const body = await req.json().catch(() => ({}));
    const action = (body?.action || '').toString().toLowerCase();
    const comment = (body?.comment || '').toString().trim();

    if (!['approve', 'reject'].includes(action)) {
        return NextResponse.json({ success: false, msg: 'Action inválida. Debe ser "approve" o "reject".' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const r = await client.query('SELECT * FROM solicitudes_edicion WHERE id=$1 FOR UPDATE', [id]);
        if (r.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Solicitud no encontrada' }, { status: 404 });
        }
        const row = r.rows[0];
        const estado = (row.estado || '').toString().toUpperCase();
        if (estado !== 'PENDIENTE') {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Solo se puede procesar solicitudes en estado PENDIENTE' }, { status: 409 });
        }

        if (action === 'reject') {
            await client.query(
                `UPDATE solicitudes_edicion
                 SET aprobado = FALSE, aprobado_por = $1, aprobado_en = NOW(), estado = 'RECHAZADO'
                 WHERE id = $2`,
                [user.id, id]
            );

            await client.query(
                `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
                 VALUES ($1,'solicitudes_edicion',$2,'REJECT',$3::jsonb)`,
                [user.id, id, JSON.stringify({ old: row, new: { ...row, estado: 'RECHAZADO', aprobado_por: user.id }, comment })]
            );

            await client.query('COMMIT'); // Commit antes de enviar email

            // Notificar al operador por correo (best effort)
            try {
                const opRes = await client.query('SELECT nombre, email FROM usuarios WHERE id = $1', [row.operador_id]);
                const op = opRes.rows[0];
                const transporter = makeTransporter();

                if (transporter && op?.email) {
                    const html = buildRejectEmail({
                        operadorNombre: op.nombre || 'Usuario',
                        solicitudId: id,
                        tabla: row.tabla,
                        motivoOriginal: row.motivo,
                        rechazadoPor: user.nombre || user.email,
                        comentarioAdmin: comment || undefined,
                    });

                    await transporter.sendMail({
                        from: process.env.SMTP_FROM || process.env.SMTP_USER,
                        to: op.email,
                        subject: `Solicitud de edición #${id} rechazada`,
                        html,
                    });
                }
            } catch (mailErr) {
                console.error('Error enviando email de rechazo:', mailErr);
            }

            return NextResponse.json({ success: true, msg: 'Solicitud rechazada y notificada' });
        }

        // === APPROVE ===
        const plainCode = String(Math.floor(1000 + Math.random() * 9000));
        const codeHash = await bcrypt.hash(plainCode, 10);
        const ttlHours = Number(process.env.AUTH_CODE_TTL_HOURS || 24);
        const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

        await client.query(
            `UPDATE solicitudes_edicion
             SET aprobado = TRUE, aprobado_por = $1, aprobado_en = NOW(), codigo_hash = $2,
                 codigo_expira_en = $3, codigo_usado = FALSE, estado = 'APROBADO'
             WHERE id = $4`,
            [user.id, codeHash, expiresAt, id]
        );

        const opRes = await client.query('SELECT u.nombre, u.email FROM usuarios u WHERE u.id = $1', [row.operador_id]);
        const op = opRes.rows[0] || { email: null, nombre: null };

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'solicitudes_edicion',$2,'APPROVE',$3::jsonb)`,
            [user.id, id, JSON.stringify({ old: row, new: { ...row, estado: 'APROBADO', aprobado_por: user.id } })]
        );

        await client.query('COMMIT');

        const transporter = makeTransporter();
        const appUrl = `${req.headers.get('x-forwarded-proto') ?? 'http'}://${req.headers.get('host') ?? ''}`;
        const subject = `Solicitud #${id} aprobada | Código: ${plainCode}`;
        const html = buildAuthCodeEmail({
            operadorNombre: op?.nombre || 'Usuario',
            solicitudId: id,
            tabla: row.tabla,
            registroId: row.registro_id,
            codigo: plainCode,
            expiresAt,
            aprobadoPor: user.nombre || user.email,
            appUrl,
        });

        if (transporter && op?.email) {
            try {
                await transporter.sendMail({
                    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@example.com',
                    to: op.email,
                    subject,
                    html,
                });
            } catch (mailErr) {
                console.error('Error enviando correo de aprobación', mailErr);
            }
        } else {
            console.log(`(DEV) Código para solicitud ${id}: ${plainCode} (dest: ${op?.email || 's/d'})`);
        }

        return NextResponse.json({ success: true, msg: 'Solicitud aprobada y código enviado' });

    } catch (e) {
        try { await client.query('ROLLBACK'); } catch {}
        console.error('PATCH /api/edit-requests/:id error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al procesar solicitud' }, { status: 500 });
    } finally {
        client.release();
    }
}
