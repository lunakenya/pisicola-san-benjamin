// app/(app)/layout.tsx
import '../globals.css';
import styles from './layout.module.css';
import SidebarServer from '@/components/SidebarServer';
import Topbar from '@/components/Topbar';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import jwt from 'jsonwebtoken';

type UserPayload = { id: number; email?: string; nombre?: string; role?: string } | null;

// helper asíncrono: path actual en SSR
async function getCurrentPathFromHeaders() {
    const h = await headers();
    const raw =
        h.get('next-url') ||
        h.get('x-invoke-path') ||
        h.get('x-matched-path') ||
        h.get('referer') ||
        '/';
    try {
        const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://d');
        return url.pathname || '/';
    } catch {
        return typeof raw === 'string' ? raw.split('?')[0].split('#')[0] : '/';
    }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value ?? null;

    if (!token) redirect('/login');

    let initialUser: UserPayload = null;
    try {
        const payload = jwt.verify(token as string, process.env.JWT_SECRET as string) as any;
        initialUser = {
            id: payload.id,
            email: payload.email,
            nombre: payload.nombre ?? payload.name,
            role: payload.role ?? payload.rol,
        };
    } catch {
        redirect('/login');
    }

    const currentPath = await getCurrentPathFromHeaders();

    return (
        <div className={styles.app}>
            <SidebarServer initialUser={initialUser} currentPath={currentPath} />
            <div className={styles.content}>
                <Topbar initialUser={initialUser} />
                <div className={styles.page}>{children}</div>
            </div>
        </div>
    );
}
