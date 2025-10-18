'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        let mounted = true;

        // rutas publicas que no deben forzar auth
        const publicPaths = ['/login', '/api/login', '/favicon.ico'];

        if (publicPaths.some((p) => pathname?.startsWith(p))) {
            setLoading(false);
            return;
        }

        fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' })
            .then((res) => {
                if (!mounted) return;
                if (!res.ok) {
                    // no autorizado -> redirigir al login
                    router.push('/login');
                    return null;
                }
                return res.json();
            })
            .catch(() => {
                if (mounted) router.push('/login');
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });

        return () => {
            mounted = false;
        };
    }, [pathname, router]);

    if (loading) {
        return <div style={{ padding: 20 }}>Cargando…</div>;
    }

    return <>{children}</>;
}
