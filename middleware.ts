import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

const PUBLIC_PATHS = ['/login', '/api/login', '/api/test-db', '/_next', '/images', '/favicon.ico'];

function getToken(req: NextRequest) {
    // cookie
    const c = req.cookies.get('auth_token')?.value;
    if (c) return c;
    // Authorization header
    const h = req.headers.get('authorization');
    if (h?.startsWith('Bearer ')) return h.slice(7);
    return null;
}

export function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;
    const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
    if (isPublic) return NextResponse.next();

    const token = getToken(req);
    if (!token) {
        if (pathname.startsWith('/api/')) {
            return NextResponse.json({ success: false, msg: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.redirect(new URL('/login', req.url));
    }

    try {
        jwt.verify(token, process.env.JWT_SECRET as string);
        return NextResponse.next();
    } catch {
        if (pathname.startsWith('/api/')) {
            return NextResponse.json({ success: false, msg: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.redirect(new URL('/login', req.url));
    }
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico|images).*)'],
};
