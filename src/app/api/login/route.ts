// src/app/api/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '@/lib/db';

export async function POST(request: NextRequest) {
    try {
        const { email, password } = await request.json();
        if (!email || !password) {
            return NextResponse.json({ success: false, msg: 'Campos obligatorios' }, { status: 400 });
        }

        const client = await pool.connect();
        try {
            const result = await client.query('SELECT id, nombre, email, password_hash, rol FROM usuarios WHERE email = $1', [email.trim().toLowerCase()]);
            if (result.rowCount === 0) {
                return NextResponse.json({ success: false, msg: 'Usuario o Contraseña incorrecta' }, { status: 401 });
            }

            const user = result.rows[0];
            const isPasswordValid = await bcrypt.compare(password, user.password_hash);
            if (!isPasswordValid) {
                return NextResponse.json({ success: false, msg: 'Usuario o Contraseña incorrecta' }, { status: 401 });
            }

            const token = jwt.sign(
                { id: user.id, email: user.email, role: user.rol, nombre: user.nombre },
                process.env.JWT_SECRET as string,
                { expiresIn: '2h' }
            );

            const res = NextResponse.json({
                success: true,
                token,
                user: { id: user.id, email: user.email, nombre: user.nombre, role: user.rol },
            }, { status: 200 });

            res.cookies.set({
                name: 'auth_token',
                value: token,
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
                maxAge: 60 * 60 * 2,
            });

            return res;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error al loguear:', err);
        return NextResponse.json({ success: false, msg: 'Error interno' }, { status: 500 });
    }
}
