// src/app/api/auth/me/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerUser } from '@/lib/auth';

export async function GET(req: NextRequest) {
    // ahora esperamos la promesa
    const user = await getServerUser(req);
    if (!user) return NextResponse.json({ success: false, msg: 'Unauthorized' }, { status: 401 });

    return NextResponse.json({ success: true, user: { id: user.id, email: user.email, nombre: user.nombre, role: user.role } });
}
