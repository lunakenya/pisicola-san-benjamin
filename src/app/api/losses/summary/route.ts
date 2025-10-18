// src/app/api/losses/summary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function GET(req: NextRequest) {
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const desde = searchParams.get('desde') || '';
    const hasta = searchParams.get('hasta') || '';

    let where = 'WHERE b.active = TRUE';
    const params: any[] = [];

    if (desde) {
        params.push(desde);
        where += ` AND b.fecha >= $${params.length}`;
    }
    if (hasta) {
        params.push(hasta);
        where += ` AND b.fecha <= $${params.length}`;
    }

    // Consulta para agrupar por lote y calcular totales por lote
    const summaryByLoteSql = `
        SELECT 
            l.id as lote_id,
            l.nombre as lote_nombre,
            SUM(b.muertos) as total_muertos,
            SUM(b.faltantes) as total_faltantes,
            SUM(b.sobrantes) as total_sobrantes,
            SUM(b.deformes) as total_deformes
        FROM bajas b
        LEFT JOIN lotes l ON l.id = b.lote_id
        ${where}
        GROUP BY l.id, l.nombre
        ORDER BY l.nombre;
    `;

    // Consulta para los totales generales
    const grandTotalsSql = `
        SELECT 
            SUM(b.muertos) as total_muertos,
            SUM(b.faltantes) as total_faltantes,
            SUM(b.sobrantes) as total_sobrantes,
            SUM(b.deformes) as total_deformes,
            COUNT(b.id) as total_registros
        FROM bajas b
        ${where};
    `;

    const client = await pool.connect();
    try {
        const [summaryRes, totalsRes] = await Promise.all([
            client.query(summaryByLoteSql, params),
            client.query(grandTotalsSql, params)
        ]);

        const summaryData = summaryRes.rows.map(row => ({
            lote_id: row.lote_id,
            lote_nombre: row.lote_nombre || 'Sin Lote',
            total_muertos: parseInt(row.total_muertos) || 0,
            total_faltantes: parseInt(row.total_faltantes) || 0,
            total_sobrantes: parseInt(row.total_sobrantes) || 0,
            total_deformes: parseInt(row.total_deformes) || 0,
        }));

        const grandTotals = {
            total_muertos: parseInt(totalsRes.rows[0].total_muertos) || 0,
            total_faltantes: parseInt(totalsRes.rows[0].total_faltantes) || 0,
            total_sobrantes: parseInt(totalsRes.rows[0].total_sobrantes) || 0,
            total_deformes: parseInt(totalsRes.rows[0].total_deformes) || 0,
            total_registros: parseInt(totalsRes.rows[0].total_registros) || 0,
        };

        return NextResponse.json({
            success: true,
            summary: summaryData,
            totals: grandTotals,
        });

    } catch (e) {
        console.error('GET /api/losses/summary error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al obtener el resumen de bajas' }, { status: 500 });
    } finally {
        client.release();
    }
}