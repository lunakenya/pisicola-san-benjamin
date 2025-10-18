// src/app/api/harvests/summary/route.ts
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
    const includeInactive = (searchParams.get('includeInactive') || 'false').toLowerCase() === 'true';

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (!includeInactive) { where += ' AND c.active = TRUE'; }

    if (desde) { params.push(desde); where += ` AND (c.fecha::date) >= $${params.length}::date`; }
    if (hasta) { params.push(hasta); where += ` AND (c.fecha::date) <= $${params.length}::date`; }

    /* Summary: group by lote + detalle (detalle_id puede ser null). */
    const summarySql = `
        SELECT
            l.id AS lote_id,
            l.nombre AS lote_nombre,
            c.detalle_id,
            dp.nombre AS detalle_nombre,
            COALESCE(SUM(c.num_truchas)::bigint, 0) AS total_truchas,
            COALESCE(SUM(c.kilos)::float, 0) AS total_kilos,
            COUNT(c.id) AS registros
        FROM cosechas c
                 LEFT JOIN lotes l ON l.id = c.lote_id
                 LEFT JOIN detalles_presentacion dp ON dp.id = c.detalle_id
            ${where}
        GROUP BY l.id, l.nombre, c.detalle_id, dp.nombre
        ORDER BY l.nombre NULLS LAST, dp.nombre NULLS LAST;
    `;

    const grandTotalsSql = `
        SELECT
            COALESCE(SUM(c.num_truchas)::bigint, 0) AS total_truchas,
            COALESCE(SUM(c.kilos)::float, 0) AS total_kilos,
            COUNT(c.id) AS total_registros
        FROM cosechas c
            ${where};
    `;

    const client = await pool.connect();
    try {
        const [summaryRes, totalsRes] = await Promise.all([
            client.query(summarySql, params),
            client.query(grandTotalsSql, params),
        ]);

        const summaryData = summaryRes.rows.map(row => ({
            // campos normalizados pensados para el frontend
            lot_id: row.lote_id ?? null,
            lot_name: row.lote_nombre ?? 'Sin Lote',
            detalle_id: row.detalle_id ?? null,
            detail_id: row.detalle_id ?? null,
            detail_name: row.detalle_nombre ?? 'Sin detalle',
            detalle_nombre: row.detalle_nombre ?? 'Sin detalle',
            total_trout: Number(row.total_truchas) || 0,
            total_truchas: Number(row.total_truchas) || 0,
            total_kilos: Number(row.total_kilos) || 0,
            registros: Number(row.registros) || 0,
            // para identificar en el cliente: key compuesto lote|detalle (consistent con front)
            key: `${row.lote_id ?? 'null'}|${row.detalle_id ?? 'null'}`,
        }));

        const totalsRow = totalsRes.rows[0] || {};
        const grandTotals = {
            total_trout: Number(totalsRow.total_truchas) || 0,
            total_truchas: Number(totalsRow.total_truchas) || 0,
            total_kilos: Number(totalsRow.total_kilos) || 0,
            total_registros: Number(totalsRow.total_registros) || 0,
        };

        // Añadimos una fila "TOTAL" al final del array summary para que el frontend
        // pueda mostrarla directamente en la tabla si lo desea.
        summaryData.push({
            lot_id: null,
            lot_name: 'TOTAL',
            detalle_id: null,
            detail_id: null,
            detail_name: null,
            detalle_nombre: null,
            total_trout: grandTotals.total_truchas,
            total_truchas: grandTotals.total_truchas,
            total_kilos: grandTotals.total_kilos,
            registros: grandTotals.total_registros,
            key: 'TOTAL',
        });

        return NextResponse.json({ success: true, summary: summaryData, totals: grandTotals });
    } catch (e) {
        console.error('GET /api/harvests/summary error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al obtener resumen de cosechas' }, { status: 500 });
    } finally {
        client.release();
    }
}
