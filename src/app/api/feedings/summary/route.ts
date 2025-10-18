// src/app/api/feedings/summary/route.ts
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

    // Base: solo activos
    let where = 'WHERE a.active = TRUE';
    const params: any[] = [];

    // Si vienen fechas, las comparamos por date (más robusto si a.fecha es timestamp/date)
    if (desde) {
        params.push(desde);
        where += ` AND (a.fecha::date) >= $${params.length}::date`;
    }
    if (hasta) {
        params.push(hasta);
        where += ` AND (a.fecha::date) <= $${params.length}::date`;
    }

    // Resumen por lote: casteamos a float y usamos COALESCE para evitar nulls
    const summaryByLoteSql = `
        SELECT
            l.id as lote_id,
            l.nombre as lote_nombre,
            COALESCE(SUM(a.cantidad)::float, 0) as total_cantidad,
            COALESCE(SUM(a.total)::float, 0) as total_valor
        FROM alimentos a
                 LEFT JOIN lotes l ON l.id = a.lote_id
            ${where}
        GROUP BY l.id, l.nombre
        ORDER BY l.nombre NULLS LAST;
    `;

    const grandTotalsSql = `
        SELECT
            COALESCE(SUM(a.cantidad)::float, 0) as total_cantidad,
            COALESCE(SUM(a.total)::float, 0) as total_valor,
            COUNT(a.id) as total_registros
        FROM alimentos a
            ${where};
    `;

    const client = await pool.connect();
    try {
        const [summaryRes, totalsRes] = await Promise.all([
            client.query(summaryByLoteSql, params),
            client.query(grandTotalsSql, params),
        ]);

        const summaryData = summaryRes.rows.map(row => ({
            lote_id: row.lote_id,
            lote_nombre: row.lote_nombre || 'Sin Lote',
            // aseguramos números JS
            total_cantidad: Number(row.total_cantidad) || 0,
            total_valor: Number(row.total_valor) || 0,
        }));

        const totalsRow = totalsRes.rows[0] || {};
        const grandTotals = {
            total_cantidad: Number(totalsRow.total_cantidad) || 0,
            total_valor: Number(totalsRow.total_valor) || 0,
            total_registros: Number(totalsRow.total_registros) || 0,
        };

        return NextResponse.json({ success: true, summary: summaryData, totals: grandTotals });
    } catch (e) {
        console.error('GET /api/feedings/summary error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al obtener el resumen de alimentaciones' }, { status: 500 });
    } finally {
        client.release();
    }
}
