
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAuthApi } from '@/lib/requireRole';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function GET(request: NextRequest, { params }: any) {
  const auth = requireAuthApi(request, ['SUPERADMIN', 'OPERADOR']);
  if (auth instanceof NextResponse) return auth;

  const { id } = params;
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM perdidas WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, msg: 'Registro no encontrado' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (e: any) {
    console.error('GET /api/losses/[id] error', e);
    return NextResponse.json({ success: false, msg: e?.message || 'Error interno' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function PUT(request: NextRequest, { params }: any) {
  const auth = requireAuthApi(request, ['SUPERADMIN', 'OPERADOR']);
  if (auth instanceof NextResponse) return auth;

  const { id } = params;
  const json = await request.json();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updateSql = 'UPDATE perdidas SET descripcion = $1, cantidad = $2 WHERE id = $3 RETURNING *';
    const result = await client.query(updateSql, [json.descripcion, json.cantidad, id]);
    await client.query('COMMIT');
    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, msg: 'Registro no encontrado' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (e: any) {
    await client.query('ROLLBACK');
    console.error('PUT /api/losses/[id] error', e);
    return NextResponse.json({ success: false, msg: e?.message || 'Error interno' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function PATCH(request: NextRequest, { params }: any) {
  const auth = requireAuthApi(request, ['SUPERADMIN', 'OPERADOR']);
  if (auth instanceof NextResponse) return auth;

  const { id } = params;
  const json = await request.json();
  const client = await pool.connect();
  try {
    const fields = [];
    const values = [];
    let index = 1;
    for (const key in json) {
      fields.push(`${key} = $${index}`);
      values.push(json[key]);
      index++;
    }
    values.push(id);
    const sql = `UPDATE perdidas SET ${fields.join(', ')} WHERE id = $${index} RETURNING *`;
    const result = await client.query(sql, values);
    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, msg: 'Registro no encontrado' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (e: any) {
    console.error('PATCH /api/losses/[id] error', e);
    return NextResponse.json({ success: false, msg: e?.message || 'Error interno' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(request: NextRequest, { params }: any) {
  const auth = requireAuthApi(request, ['SUPERADMIN', 'OPERADOR']);
  if (auth instanceof NextResponse) return auth;

  const { id } = params;
  const client = await pool.connect();
  try {
    const result = await client.query('DELETE FROM perdidas WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, msg: 'Registro no encontrado' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (e: any) {
    console.error('DELETE /api/losses/[id] error', e);
    return NextResponse.json({ success: false, msg: e?.message || 'Error interno' }, { status: 500 });
  } finally {
    client.release();
  }
}
