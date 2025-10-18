'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import styles from './Topbar.module.css';
import { FiUser } from 'react-icons/fi';

type User = { id: number; email?: string; nombre?: string; role?: string } | null;

export default function Topbar({ initialUser }: { initialUser?: User }) {
    const pathname = usePathname() ?? '';
    const [now, setNow] = useState('');
    const [user, setUser] = useState<User>(initialUser ?? null);

    useEffect(() => {
        const tick = () => {
            const dt = new Intl.DateTimeFormat('es-EC', {
                timeZone: 'America/Guayaquil',
                hour12: false,
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            }).format(new Date());
            setNow(dt);
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        if (initialUser) return;
        let mounted = true;
        fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => {
                if (!mounted) return;
                if (j?.success) setUser(j.user);
            })
            .catch(() => { if (mounted) setUser(null); });
        return () => { mounted = false; };
    }, [initialUser]);

    const titleMap: Record<string, string> = {
        '/catalogs': 'Catálogos',
        '/catalogs/providers': 'Proveedores',
        '/catalogs/pools': 'Piscinas',
        '/catalogs/lotes': 'Lotes',
        '/losses': 'Bajas',
        '/edit-requests': 'Solicitudes',
        '/users': 'Usuarios',
        '/harvests': 'Hoja de Cosecha',
        '/feedings': 'Alimentos',

    };

    const title = (() => {
        const keys = Object.keys(titleMap).sort((a, b) => b.length - a.length);
        for (const k of keys) {
            if (pathname.startsWith(k)) return titleMap[k];
        }
        return 'Panel';
    })();

    return (
        <header className={styles.topbar} role="banner">
            {/* izquierda: título */}
            <div className={styles.left}>
                <span className={styles.title} title={title}>{title}</span>
            </div>

            {/* centro: columna fija para la hora (alineada a la izquierda dentro de esa columna) */}
            <div className={styles.center}>
                <span className={styles.time}>Hora GYE: {now}</span>
            </div>

            {/* derecha: usuario */}
            <div className={styles.user} role="region" aria-label="Usuario">
                <FiUser className={styles.userIcon} />
                <span>Hola, {user?.nombre ?? 'Usuario'}</span>
            </div>
        </header>
    );
}
