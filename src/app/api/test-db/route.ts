import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET() {
    try {
        const result = await query('SELECT NOW()')
        return NextResponse.json({ success: true, time: result.rows[0].now })
    } catch (error) {
        console.error(error)
        return NextResponse.json({ success: false, error: 'Database connection failed' }, { status: 500 })
    }
}