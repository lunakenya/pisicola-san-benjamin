'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function logoutAction() {
    // borra el JWT
    cookies().set('auth_token', '', {
        path: '/',
        expires: new Date(0),
        httpOnly: true,
        sameSite: 'lax',
    });

    // redirige después de cerrar sesión
    redirect('/login?logged_out=1');
}
