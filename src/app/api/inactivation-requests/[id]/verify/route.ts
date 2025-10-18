// src/app/api/inactivation-requests/[id]/verify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function parseId(param: any) {
    const id = Number(param);
    return Number.isInteger(id) && id > 0 ? id : null;
}

// POST /api/inactivation-requests/:id/verify
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> } // ✅ params async
) {
    const { id: idStr } = await params;              // ✅ esperar params
    const id = parseId(idStr);
    if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

    const auth = requireAuthApi(req, ['OPERADOR', 'SUPERADMIN']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    const { codigo = '' } = await req.json().catch(() => ({}));
    if (!codigo.toString().trim()) {
        return NextResponse.json({ success: false, msg: 'Código requerido' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const r = await client.query('SELECT * FROM solicitudes_inactivacion WHERE id=$1 FOR UPDATE', [id]);
        if (r.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Solicitud no encontrada' }, { status: 404 });
        }
        const row = r.rows[0];

        if ((user.role ?? '') !== 'SUPERADMIN' && Number(row.operador_id) !== Number(user.id)) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'No autorizado' }, { status: 403 });
        }

        if (!row.aprobado || !row.codigo_hash) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'La solicitud no tiene código aprobado' }, { status: 400 });
        }
        if (row.codigo_usado) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'El código ya fue usado' }, { status: 400 });
        }
        if (row.codigo_expira_en && new Date() > new Date(row.codigo_expira_en)) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'El código ha expirado' }, { status: 400 });
        }

        const ok = await bcrypt.compare(codigo.toString().trim(), row.codigo_hash);
        if (!ok) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Código inválido' }, { status: 400 });
        }

        await client.query(`UPDATE solicitudes_inactivacion SET codigo_usado = TRUE WHERE id=$1`, [id]);
        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'solicitudes_inactivacion',$2,'CODE_USED',$3::jsonb)`,
            [user.id, id, JSON.stringify({ solicitud_id: id, used_by: user.id, used_at: new Date().toISOString() })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true, msg: 'Código verificado para inactivación/restauración.' });
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch {}
        console.error('POST /api/inactivation-requests/:id/verify error', e);
        return NextResponse.json({ success: false, msg: 'Error interno' }, { status: 500 });
    } finally {
        client.release();
    }
}
