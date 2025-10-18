import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function GET(req: NextRequest) {
    const auth = requireAuthApi(req, ['OPERADOR', 'SUPERADMIN']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    const { searchParams } = new URL(req.url);
    const tabla = (searchParams.get('tabla') || '').trim();
    const registroIdRaw = searchParams.get('registro_id');
    const registro_id = Number(registroIdRaw);

    if (!tabla || !Number.isInteger(registro_id) || registro_id <= 0) {
        return NextResponse.json({ success: false, msg: 'Parámetros inválidos' }, { status: 400 });
    }

    const byOperator = (user.role ?? '').toString().toUpperCase() !== 'SUPERADMIN';

    const client = await pool.connect();
    try {
        // ✅ Igual que edición: devolver SIEMPRE la última solicitud
        const params: any[] = [tabla, registro_id];
        let where = `s.tabla = $1 AND s.registro_id = $2`;
        if (byOperator) {
            params.push(user.id);
            where += ` AND s.operador_id = $${params.length}`;
        }

        const sql = `
      SELECT s.*
      FROM solicitudes_inactivacion s
      WHERE ${where}
      ORDER BY s.creado_en DESC
      LIMIT 1
    `;
        const r = await client.query(sql, params);

        if (r.rowCount === 0) {
            return NextResponse.json({ success: true, pending: false });
        }

        const row = r.rows[0];
        const estado = (row.estado || '').toString().toUpperCase();

        let hasCode = false;
        if (estado === 'APROBADO' && row.codigo_hash) {
            const now = new Date();
            const exp = row.codigo_expira_en ? new Date(row.codigo_expira_en) : null;
            const expirado = exp ? now > exp : false;
            const usado = !!row.codigo_usado;
            hasCode = !expirado && !usado;
        }

        const pending =
            estado === 'PENDIENTE' || (estado === 'APROBADO' && hasCode);

        return NextResponse.json({
            success: true,
            pending,
            request: {
                id: row.id,
                estado,                // <- permitirá mostrar el aviso “rechazada”
                hasCode,
                expiresAt: row.codigo_expira_en ?? null,
                operador_id: row.operador_id,
            },
        });
    } catch (e) {
        console.error('GET /api/inactivation-requests/pending error', e);
        return NextResponse.json({ success: false, msg: 'Error interno' }, { status: 500 });
    } finally {
        client.release();
    }
}
