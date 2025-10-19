import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, JWTPayload } from './jwt';

/**
 * Extrae token desde:
 * 1) cookie 'auth_token'
 * 2) header Authorization: Bearer <token>
 *
 * Acepta tanto NextRequest (API) como un objeto que tenga `headers` (fallback).
 */
export function extractTokenFromRequest(req: NextRequest | { headers?: Headers; cookies?: any }): string | null {
    try {
        // cookie (NextRequest has cookies.get(name)?.value)
        // @ts-expect-error - NextRequest cookies typing in different next versions can vary
        const cookieVal = req.cookies?.get?.('auth_token')?.value;
        if (cookieVal) return cookieVal;

        // header
        const headerAuth = req.headers?.get?.('authorization') ?? (req as any).headers?.authorization;
        if (typeof headerAuth === 'string' && headerAuth.startsWith('Bearer ')) {
            return headerAuth.slice(7);
        }
    } catch {
        // swallow and return null
    }
    return null;
}

/**
 * Uso en handlers de API (app dir route.ts).
 *
 * - Si el token está ausente o inválido, devuelve un NextResponse con el status correspondiente.
 * - Si hay autorización y rol permitido, devuelve el payload del user.
 *
 * USO:
 * const auth = requireAuthApi(req, ['SUPERADMIN','OPERADOR']);
 * if (auth instanceof NextResponse) return auth; // responde desde el helper
 * // otherwise "auth" es el payload del usuario
 */
export function requireAuthApi(req: NextRequest, allowedRoles?: string[] | undefined): NextResponse | JWTPayload {
    const token = extractTokenFromRequest(req);
    if (!token) {
        return NextResponse.json({ success: false, msg: 'Unauthorized' }, { status: 401 });
    }

    try {
        const payload = verifyToken<JWTPayload>(token);
        const role = (payload.role ?? payload.rol ?? '').toString();

        if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
            return NextResponse.json({ success: false, msg: 'Forbidden' }, { status: 403 });
        }

        // OK: devolvemos payload para que el handler lo use
        return payload;
    } catch (err) {
        return NextResponse.json({ success: false, msg: 'Invalid token' }, { status: 401 });
    }
}

/**
 * Uso dentro de Server Components / Server pages (app dir).
 * - cookiesProvider debe ser el resultado de `import { cookies } from 'next/headers'` (llama cookies()).
 *
 * EJEMPLO server page:
 * const user = requireAuthServer(cookies, ['SUPERADMIN']);
 * if (!user) redirect('/login');
 */
export function requireAuthServer(
    cookiesProvider: ReturnType<typeof import('next/headers').cookies>,
    allowedRoles?: string[]
): JWTPayload | null {
    const cookie = cookiesProvider().get('auth_token')?.value;
    if (!cookie) return null;

    try {
        const payload = verifyToken<JWTPayload>(cookie);
        const role = (payload.role ?? payload.rol ?? '').toString();

        if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
            return null;
        }
        return payload;
    } catch {
        return null;
    }
}
