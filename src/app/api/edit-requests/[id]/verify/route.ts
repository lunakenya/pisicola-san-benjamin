// src/app/api/edit-requests/[id]/verify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function parseId(param: any) {
    const id = Number(param);
    if (!Number.isInteger(id) || id <= 0) return null;
    return id;
}

// POST /api/edit-requests/:id/verify
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id: idStr } = await params;
    const id = parseId(idStr);
    if (!id) return NextResponse.json({ success: false, msg: 'ID inválido' }, { status: 400 });

    const auth = requireAuthApi(req, ['OPERADOR', 'SUPERADMIN']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    const json = await req.json().catch(() => ({}));
    const codigo = (json?.codigo || '').toString().trim();
    if (!codigo) return NextResponse.json({ success: false, msg: 'Código requerido' }, { status: 400 });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const r = await client.query('SELECT * FROM solicitudes_edicion WHERE id=$1 FOR UPDATE', [id]);
        if (r.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Solicitud no encontrada' }, { status: 404 });
        }
        const row = r.rows[0];

        // Solo el SUPERADMIN o el mismo operador pueden verificar su código
        if ((user.role ?? '').toString().toUpperCase() !== 'SUPERADMIN' && Number(row.operador_id) !== Number(user.id)) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'No autorizado para verificar este código' }, { status: 403 });
        }

        if (!row.aprobado || !row.codigo_hash) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'La solicitud no ha sido aprobada o no tiene código' }, { status: 400 });
        }
        if (row.codigo_usado) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'El código ya fue usado' }, { status: 400 });
        }

        const now = new Date();
        if (row.codigo_expira_en && now > new Date(row.codigo_expira_en)) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'El código ha expirado' }, { status: 400 });
        }

        const match = await bcrypt.compare(codigo, row.codigo_hash);
        if (!match) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, msg: 'Código inválido' }, { status: 400 });
        }

        await client.query(`UPDATE solicitudes_edicion SET codigo_usado = TRUE WHERE id=$1`, [id]);
        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
             VALUES ($1,'solicitudes_edicion',$2,'CODE_USED',$3::jsonb)`,
            [user.id, id, JSON.stringify({ solicitud_id: id, used_by: user.id, used_at: new Date().toISOString() })]
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true, msg: 'Código verificado. Ahora puede editar el registro.' });
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch {}
        console.error('POST /api/edit-requests/:id/verify error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al verificar código' }, { status: 500 });
    } finally {
        client.release();
    }
}
