// src/app/api/edit-requests/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/* ========= Validación ========= */
const CreateRequestSchema = z.object({
    tabla: z.string().min(1, 'Tabla requerida').max(50),
    registro_id: z.number().int().min(1, 'registro_id inválido'),
    motivo: z.string().min(5, 'Motivo demasiado corto').max(2000),
});

/* ========= Mail ========= */
function makeTransporter() {
    if (!process.env.SMTP_HOST) return null;
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
    });
}

/** Email HTML a administradores */
function buildHtmlEmail(opts: {
    solicitudId: number;
    tabla: string;
    registroId: number;
    operadorNombre?: string;
    motivo: string;
    resumen?: string;
    appUrl?: string;
}) {
    const { solicitudId, tabla, operadorNombre, motivo, resumen } = opts;

    const primaryGreen = '#0f8b44';
    const darkGreen = '#0b6633';
    const lightBg = '#f5f7fa';
    const textDark = '#1a202c';
    const textGray = '#4a5568';
    const borderColor = '#e2e8f0';
    const logoUrl =
        'https://raw.githubusercontent.com/ChristopherPalloArias/Logos/master/logo.png';

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Nueva Solicitud de Edición</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');</style>
</head>
<body style="margin:0;padding:0;background:${lightBg};font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${lightBg};padding:40px 20px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.06)">
<tr><td style="background:linear-gradient(135deg,${primaryGreen} 0%,${darkGreen} 100%);padding:40px;text-align:center">
<img src="${logoUrl}" width="80" height="80" alt="Logo" style="display:block;margin:0 auto 20px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.15)"/>
<h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;letter-spacing:-.5px">Nueva Solicitud de Edición</h1>
<p style="color:rgba(255,255,255,.9);margin:8px 0 0;font-size:14px;font-weight:500">Requiere revisión del equipo administrativo</p>
</td></tr>
<tr><td style="padding:40px">
<p style="margin:0 0 24px;color:${textDark};font-size:16px;line-height:1.6;font-weight:500">Hola equipo,</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px;background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);border-radius:12px;border:2px solid ${primaryGreen};overflow:hidden"><tr><td style="padding:24px;text-align:center">
<div style="color:${textGray};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Solicitud</div>
<div style="color:${primaryGreen};font-size:48px;font-weight:800;line-height:1;letter-spacing:-1px">#${solicitudId}</div>
</td></tr></table>
<div style="margin:0 0 32px">
<h2 style="color:${textDark};font-size:18px;font-weight:700;margin:0 0 20px;border-bottom:2px solid ${borderColor};padding-bottom:12px">Detalles de la Solicitud</h2>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tr><td style="padding:14px 0;border-bottom:1px solid ${borderColor};width:35%"><span style="color:${textGray};font-size:14px;font-weight:600">Tabla</span></td>
<td style="padding:14px 0;border-bottom:1px solid ${borderColor};text-align:right"><span style="color:${textDark};font-size:14px;font-weight:700;background:#f8fafc;padding:6px 12px;border-radius:6px;display:inline-block">${tabla}</span></td></tr>
<tr><td style="padding:14px 0;border-bottom:1px solid ${borderColor}"><span style="color:${textGray};font-size:14px;font-weight:600">Solicitado por</span></td>
<td style="padding:14px 0;border-bottom:1px solid ${borderColor};text-align:right"><span style="color:${textDark};font-size:14px;font-weight:600">${operadorNombre || 'Usuario'}</span></td></tr>
<tr><td colspan="2" style="padding:14px 0">
<span style="color:${textGray};font-size:14px;font-weight:600;display:block;margin-bottom:10px">Comentario</span>
<div style="background:#f8fafc;border-left:4px solid ${primaryGreen};padding:16px;border-radius:6px;margin-top:8px">
<p style="margin:0;color:${textDark};font-size:14px;line-height:1.7;white-space:pre-wrap">${motivo}</p>
</div></td></tr></table></div>
${
        resumen
            ? `<div style="margin:0 0 32px"><h2 style="color:${textDark};font-size:18px;font-weight:700;margin:0 0 16px;border-bottom:2px solid ${borderColor};padding-bottom:12px">Información del Registro</h2>
<div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:8px;padding:20px;position:relative">
<div style="position:absolute;top:-10px;left:16px;background:${primaryGreen};color:#fff;padding:4px 12px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Resumen</div>
<pre style="margin:12px 0 0;font-family:'SF Mono','Monaco','Menlo','Consolas',monospace;font-size:13px;color:${textDark};white-space:pre-wrap;line-height:1.8">${resumen
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')}</pre></div></div>`
            : ''
    }
<div style="background:#fffbeb;border:2px solid #fbbf24;border-radius:8px;padding:20px;margin:0 0 32px">
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="width:32px;vertical-align:top;padding-right:12px">
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
</td>
<td style="vertical-align:top">
<h3 style="margin:0 0 8px;color:#92400e;font-size:14px;font-weight:700">Acción requerida</h3>
<p style="margin:0;color:#78350f;font-size:13px;line-height:1.6">Ingresa al panel de administración para revisar esta solicitud y tomar una decisión (aprobar o rechazar).</p>
</td></tr></table></div>
<div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:center"><p style="margin:0;color:#64748b;font-size:12px;line-height:1.6">Este correo es generado automáticamente por el sistema. No es necesario responder este mensaje.</p></div>
</td></tr>
<tr><td style="background:#f8fafc;padding:24px;border-top:1px solid ${borderColor};text-align:center">
<p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:600">Piscícola San Benjamín</p>
<p style="margin:0;color:#94a3b8;font-size:11px">© ${new Date().getFullYear()} Todos los derechos reservados</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/* ========= POST: crear solicitud (OPERADOR/SUPERADMIN) ========= */
export async function POST(req: NextRequest) {
    const auth = requireAuthApi(req, ['OPERADOR', 'SUPERADMIN']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    // coacción por si llega string numérico
    const jsonRaw = await req.json().catch(() => ({}));
    const json = {
        ...jsonRaw,
        registro_id:
            typeof jsonRaw?.registro_id === 'string'
                ? Number(jsonRaw.registro_id)
                : jsonRaw?.registro_id,
    };

    const parsed = CreateRequestSchema.safeParse(json);
    if (!parsed.success) {
        const msg = parsed.error.issues?.[0]?.message || 'Datos inválidos';
        return NextResponse.json({ success: false, msg }, { status: 400 });
    }

    const { tabla, registro_id, motivo } = parsed.data;

    // destinatarios admin
    const adminEmails = (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const recipients =
        adminEmails.length > 0
            ? adminEmails
            : ['soporteusuariosbenjamin@gmail.com', 'cipallo@uce.edu.ec'];

    const client = await pool.connect();
    try {
        // idempotencia: si ya hay PENDIENTE del mismo operador y registro, devolver OK
        const dup = await client.query(
            `SELECT *
             FROM solicitudes_edicion
             WHERE tabla = $1 AND registro_id = $2 AND operador_id = $3 AND estado = 'PENDIENTE'
             ORDER BY creado_en DESC
                 LIMIT 1`,
            [tabla, registro_id, user.id]
        );
        if (dup.rowCount > 0) {
            return NextResponse.json(
                { success: true, pending: true, data: dup.rows[0] },
                { status: 200 }
            );
        }

        await client.query('BEGIN');

        const ins = await client.query(
            `INSERT INTO solicitudes_edicion (tabla, registro_id, operador_id, motivo, estado, creado_en)
             VALUES ($1,$2,$3,$4,'PENDIENTE', NOW())
                 RETURNING id, tabla, registro_id, operador_id, motivo, estado, creado_en`,
            [tabla, registro_id, user.id, motivo]
        );

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'solicitudes_edicion',$2,'INSERT',$3::jsonb)`,
            [user.id, ins.rows[0].id, JSON.stringify({ new: ins.rows[0] })]
        );

        // Resumen opcional (para 'bajas')
        let resumen = '';
        if (tabla === 'bajas') {
            const r = await client.query(
                `SELECT b.id, b.fecha, l.nombre AS lote_nombre, p.nombre AS piscina_nombre,
                        b.muertos, b.faltantes, b.sobrantes, b.deformes
                 FROM bajas b
                          LEFT JOIN lotes l ON l.id = b.lote_id
                          LEFT JOIN piscinas p ON p.id = b.piscina_id
                 WHERE b.id = $1`,
                [registro_id]
            );
            if (r.rowCount > 0) {
                const row = r.rows[0];
                resumen = [
                    `ID: ${row.id}`,
                    `Fecha: ${row.fecha}`,
                    `Lote: ${row.lote_nombre ?? '—'}`,
                    `Piscina: ${row.piscina_nombre ?? '—'}`,
                    `Muertos: ${row.muertos ?? 0}`,
                    `Faltantes: ${row.faltantes ?? 0}`,
                    `Sobrantes: ${row.sobrantes ?? 0}`,
                    `Deformes: ${row.deformes ?? 0}`,
                ].join('\n');
            }
        }

        await client.query('COMMIT');

        // Email a administradores (si SMTP)
        const transporter = makeTransporter();
        const operadorNombre = user?.nombre ?? user?.email;
        const html = buildHtmlEmail({
            solicitudId: ins.rows[0].id,
            tabla,
            registroId: registro_id,
            operadorNombre,
            motivo,
            resumen,
            appUrl: `${req.headers.get('x-forwarded-proto') ?? 'http'}://${req.headers.get('host') ?? ''}`,
        });
        const subject = `Nueva Solicitud #${ins.rows[0].id} | ${operadorNombre} | Tabla: ${tabla}`;

        let emailWarning = false;
        if (transporter) {
            try {
                await transporter.sendMail({
                    from:
                        process.env.SMTP_FROM ||
                        (process.env.SMTP_USER ?? 'no-reply@example.com'),
                    to: recipients.join(','),
                    subject,
                    html,
                });
            } catch (mailErr) {
                console.error('Error enviando correo de nueva solicitud', mailErr);
                emailWarning = true; // no bloqueamos la respuesta
            }
        } else {
            // modo dev
            console.log('--- EMAIL (dev) : nueva solicitud ---');
            console.log('To:', recipients.join(','));
            console.log('Subject:', subject);
            console.log('HTML:', html);
        }

        return NextResponse.json(
            { success: true, data: ins.rows[0], emailWarning },
            { status: 201 }
        );
    } catch (e) {
        try {
            await client.query('ROLLBACK');
        } catch {}
        console.error('POST /api/edit-requests error', e);
        return NextResponse.json(
            { success: false, msg: 'Error interno al crear solicitud' },
            { status: 500 }
        );
    } finally {
        client.release();
    }
}

/* ========= GET: listar (solo SUPERADMIN) ========= */
export async function GET(req: NextRequest) {
    const auth = requireAuthApi(req, ['SUPERADMIN']);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const estado = (searchParams.get('estado') || '').trim().toUpperCase();
    const operador_id = searchParams.get('operador_id') || '';
    const q = (searchParams.get('q') || '').trim();
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const pageSize = Math.max(
        1,
        Math.min(200, Number(searchParams.get('pageSize') || 50))
    );
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (estado) {
        params.push(estado);
        where += ` AND s.estado = $${params.length}`;
    }
    if (operador_id) {
        params.push(Number(operador_id));
        where += ` AND s.operador_id = $${params.length}`;
    }
    if (q.length > 0) {
        params.push(`%${q}%`);
        params.push(`%${q}%`);
        params.push(`%${q}%`);
        where += ` AND (s.motivo ILIKE $${params.length - 2} OR s.tabla ILIKE $${params.length - 1} OR u.nombre ILIKE $${params.length})`;
    }

    const countSql = `SELECT COUNT(*) AS total
                      FROM solicitudes_edicion s
                               LEFT JOIN usuarios u ON u.id = s.operador_id
                          ${where}`;

    const dataSql = `
        SELECT s.*,
               u.nombre  AS operador_nombre,
               u.email   AS operador_email,
               ua.nombre AS aprobado_nombre
        FROM solicitudes_edicion s
                 LEFT JOIN usuarios u  ON u.id  = s.operador_id
                 LEFT JOIN usuarios ua ON ua.id = s.aprobado_por
            ${where}
        ORDER BY s.creado_en DESC
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
        console.error('GET /api/edit-requests error', e);
        return NextResponse.json(
            { success: false, msg: 'Error interno al listar solicitudes' },
            { status: 500 }
        );
    } finally {
        client.release();
    }
}
