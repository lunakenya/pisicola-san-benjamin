import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

const PUBLIC_PATHS = ['/login', '/api/login', '/api/test-db', '/_next', '/images', '/favicon.ico'];

// Corrección 1: Especificar el tipo de retorno de la función
function getToken(req: NextRequest): string | null {
    // cookie
    const c = req.cookies.get('auth_token')?.value;
    if (c) return c;
    
    // Authorization header
    const h = req.headers.get('authorization');
    // La verificación de 'h' como string se maneja con el operador ?.
    if (h?.startsWith('Bearer ')) return h.slice(7);
    
    return null;
}

export function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;
    
    const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
    if (isPublic) return NextResponse.next();

    const token = getToken(req);
    
    // Si no hay token, redirige o retorna 401
    if (!token) {
        if (pathname.startsWith('/api/')) {
            return NextResponse.json({ success: false, msg: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.redirect(new URL('/login', req.url));
    }

    // Manejo de verificación JWT
    try {
        // Aseguramos que JWT_SECRET es un string no nulo/indefinido (Next.js lo garantiza si está en Vercel)
        jwt.verify(token, process.env.JWT_SECRET as string);
        return NextResponse.next();
        
    // Corrección 2: Usar 'unknown' o una variable ignorada en el catch
    // Usamos 'unknown' como tipo más seguro que 'any'
    } catch (error: unknown) { 
        if (pathname.startsWith('/api/')) {
            return NextResponse.json({ success: false, msg: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.redirect(new URL('/login', req.url));
    }
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico|images).*)'],
};