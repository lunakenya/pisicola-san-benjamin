import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function round3(v: number) { return Math.round(v * 1000) / 1000; }
function round0(v: number) { return Math.round(v); }

export async function GET(req: NextRequest) {
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const desde = searchParams.get('desde') || '';
    const hasta = searchParams.get('hasta') || '';
    const includeInactive = (searchParams.get('includeInactive') || 'false').toLowerCase() === 'true';
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const pageSize = Math.max(1, Math.min(200, Number(searchParams.get('pageSize') || 50)));
    const offset = (page - 1) * pageSize;

    let baseWhere = 'WHERE 1=1';
    const params: any[] = [];

    if (!includeInactive) baseWhere += ' AND c.active = TRUE';

    if (desde) { params.push(desde); baseWhere += ` AND c.fecha >= $${params.length}`; }
    if (hasta) { params.push(hasta); baseWhere += ` AND c.fecha <= $${params.length}`; }

    if (q.length > 0) {
        params.push(`%${q}%`);
        const numericQ = parseInt(q.replace(/\D/g, ''), 10);
        const hasNumeric = !isNaN(numericQ);
        let cond = `(l.nombre ILIKE $${params.length} OR p.nombre ILIKE $${params.length} OR c.nro_hoja_cosecha ILIKE $${params.length})`;
        if (hasNumeric) {
            cond = `(l.nombre ILIKE $${params.length} OR p.nombre ILIKE $${params.length} OR c.nro_hoja_cosecha ILIKE $${params.length} OR c.num_truchas = ${numericQ} OR c.kilos = ${numericQ})`;
        }
        baseWhere += ` AND ${cond}`;
    }

    const countSql = `
        SELECT COUNT(*) AS total
        FROM cosechas c
                 LEFT JOIN lotes l ON l.id = c.lote_id
                 LEFT JOIN piscinas p ON p.id = c.piscina_id
            ${baseWhere}
    `;

    const dataSql = `
        SELECT c.*,
               l.id AS lote_id, l.nombre AS lote_nombre, l.nombre AS lot_name,
               p.id AS piscina_id, p.nombre AS piscina_nombre, p.nombre AS pond_name,
               d.id AS detalle_id, d.nombre AS detalle_nombre, d.nombre AS detail_name,
               tp.id AS tipo_paquete_id, tp.nombre AS tipo_paquete_nombre, tp.nombre AS package_count_label
        FROM cosechas c
                 LEFT JOIN lotes l ON l.id = c.lote_id
                 LEFT JOIN piscinas p ON p.id = c.piscina_id
                 LEFT JOIN detalles_presentacion d ON d.id = c.detalle_id
                 LEFT JOIN tipos_paquete tp ON tp.id = c.tipo_paquete_id
            ${baseWhere}
        ORDER BY c.fecha DESC, c.id DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const client = await pool.connect();
    try {
        const totalRes = await client.query(countSql, params);
        const total = Number(totalRes.rows[0]?.total || 0);
        const dataRes = await client.query(dataSql, [...params, pageSize, offset]);

        // normalize rows for frontend
        const rows = dataRes.rows.map((row: any) => ({
            ...row,
            id: row.id,
            date: row.fecha,
            lot_id: row.lote_id,
            lot_name: row.lot_name ?? row.lote_nombre,
            pond_id: row.piscina_id,
            pond_name: row.pond_name ?? row.piscina_nombre,
            detail_id: row.detalle_id,
            detail_name: row.detail_name ?? row.detalle_nombre,
            package_count_id: row.tipo_paquete_id ?? null,
            package_count_label: row.package_count_label ?? row.tipo_paquete_nombre ?? null,
            trout_count: Number(row.num_truchas ?? 0),
            sheet_number: row.nro_hoja_cosecha ?? null,
            kilos: row.kilos != null ? Number(row.kilos) : null,
            kilos_text: row.kilos != null ? Number(row.kilos) : null,
            active: row.active,
        }));

        return NextResponse.json({
            success: true,
            data: rows,
            page,
            pageSize,
            total,
            pages: Math.max(1, Math.ceil(total / pageSize)),
        });
    } catch (e) {
        console.error('GET /api/harvests error', e);
        return NextResponse.json({ success: false, msg: 'Error interno al obtener cosechas' }, { status: 500 });
    } finally {
        client.release();
    }
}

export async function POST(req: NextRequest) {
    const auth = requireAuthApi(req, ['SUPERADMIN', 'OPERADOR']);
    if (auth instanceof NextResponse) return auth;
    const user = auth as any;

    const json = await req.json().catch(() => ({}));

    // Map flexible incoming keys (front uses english keys; backend older code used spanish)
    const fecha = json.date ?? json.fecha;
    const lote_id = json.lot_id ?? json.lote_id ?? null;
    const piscina_id = json.pond_id ?? json.piscina_id ?? null;
    const num_truchas = json.trout_count ?? json.num_truchas ?? 0;
    const nro_hoja_cosecha = json.sheet_number ?? json.nro_hoja_cosecha ?? null;
    const kilos_in = json.kilos_text ?? json.kilos ?? 0;
    const paquetes_in = json.paquetes ?? null; // optional
    const tipo_paquete_id = json.package_count_id ?? json.tipo_paquete_id ?? null;
    const detalle_id = json.detail_id ?? json.detalle_id ?? null;
    const active = json.active;

    // basic validations
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return NextResponse.json({ success: false, msg: 'Fecha inválida. Formato YYYY-MM-DD' }, { status: 400 });
    }
    if (!Number.isFinite(Number(num_truchas)) || Number(num_truchas) < 0) {
        return NextResponse.json({ success: false, msg: 'num_truchas inválido' }, { status: 400 });
    }
    const kilosVal = kilos_in == null ? 0 : Number(String(kilos_in).toString().replace(',', '.'));
    if (kilos_in != null && (!Number.isFinite(Number(kilosVal)) || Number(kilosVal) < 0)) {
        return NextResponse.json({ success: false, msg: 'kilos inválido' }, { status: 400 });
    }

    const kilosR = round3(Number(kilosVal ?? 0));
    const paquetesR = paquetes_in != null ? round0(Number(paquetes_in)) : 0;
    const numTruchasR = round0(Number(num_truchas ?? 0));

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insertSql = `
      INSERT INTO cosechas
      (lote_id, piscina_id, fecha, num_truchas, nro_hoja_cosecha, kilos, paquetes, tipo_paquete_id, detalle_id, creado_por, creado_en, active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(), COALESCE($11, TRUE))
      RETURNING *
    `;
        const vals = [
            lote_id,
            piscina_id,
            fecha,
            numTruchasR,
            nro_hoja_cosecha,
            Number(Number(kilosR).toFixed(3)),
            paquetesR,
            tipo_paquete_id,
            detalle_id,
            user.id,
            active === undefined ? null : active,
        ];

        const ins = await client.query(insertSql, vals);

        await client.query(
            `INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, detalle)
       VALUES ($1, 'cosechas', $2, 'INSERT', $3::jsonb)`,
            [user.id, ins.rows[0].id, JSON.stringify({ new: ins.rows[0] })]
        );

        await client.query('COMMIT');

        const row = ins.rows[0];
        const payload = {
            ...row,
            date: row.fecha,
            lot_id: row.lote_id,
            lot_name: row.lote_nombre ?? null,
            pond_id: row.piscina_id,
            pond_name: row.piscina_nombre ?? null,
            detail_id: row.detalle_id,
            detail_name: row.detalle_nombre ?? null,
            package_count_id: row.tipo_paquete_id ?? null,
            package_count_label: row.tipo_paquete_nombre ?? null,
            trout_count: Number(row.num_truchas ?? 0),
            sheet_number: row.nro_hoja_cosecha ?? null,
            kilos: row.kilos != null ? Number(row.kilos) : null,
            kilos_text: row.kilos != null ? Number(row.kilos) : null,
        };

        return NextResponse.json({ success: true, data: payload }, { status: 201 });
    } catch (e: any) {
        await client.query('ROLLBACK');
        console.error('POST /api/harvests error', e);
        if (e?.code === '23505') return NextResponse.json({ success: false, msg: 'Conflicto (duplicado)' }, { status: 409 });
        return NextResponse.json({ success: false, msg: 'Error interno al crear cosecha' }, { status: 500 });
    } finally {
        client.release();
    }
}
