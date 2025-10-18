// src/lib/auth.ts
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

export type ServerUser = {
    id: number;
    email?: string;
    role?: string;
    nombre?: string;
};

export async function getServerUser(req?: NextRequest): Promise<ServerUser | null> {
    try {
        let token: string | null = null;

        if (req) {
            // cuando se llama desde handlers pasando `req`, usamos req.cookies (sin problemas)
            token = req.cookies?.get('auth_token')?.value ?? null;
            const auth = req.headers.get('authorization');
            if (!token && auth?.startsWith('Bearer ')) token = auth.slice(7);
        } else {
            // cuando se llama sin `req` (server-side), usamos next/headers cookies()
            // getServerUser es async para que el llamador haga `await getServerUser()`
            const c = cookies().get('auth_token');
            token = c?.value ?? null;
        }

        if (!token) return null;

        const payload = jwt.verify(token, process.env.JWT_SECRET as string) as any;

        return {
            id: Number(payload.id),
            email: payload.email,
            role: payload.role ?? payload.rol,
            nombre: payload.nombre ?? payload.name,
        };
    } catch (e) {
        return null;
    }
}
