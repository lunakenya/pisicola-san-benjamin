'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import styles from './Sidebar.module.css';
import type { IconType } from 'react-icons';
import { FiAlertTriangle, FiFileText, FiBarChart2, FiGrid, FiLogOut, FiMail, FiUserPlus } from 'react-icons/fi';
import * as GiIcons from 'react-icons/gi';
import React, { useEffect, useState } from 'react';

type Rol = 'SUPERADMIN' | 'OPERADOR' | string | undefined;
type NavItem = { href: string; label: string; icon?: IconType };
type User = { id: number; role?: Rol; nombre?: string } | null;

// enlaces base (contienen "Cosecha" por defecto)
const baseLinks: NavItem[] = [
    { href: '/feedings',    label: 'Alimentos',     icon: (GiIcons as any).GiFish ?? FiGrid },
    { href: '/losses',      label: 'Bajas',         icon: FiAlertTriangle },
    { href: '/harvests',    label: 'Hoja Cosecha',  icon: FiFileText },
    { href: '/cosecha',     label: 'Cosecha',       icon: FiBarChart2 }, // <- visible excepto a OPERADOR
    { href: '/catalogs',    label: 'Catálogos',     icon: FiGrid },
];

export default function Sidebar({ initialUser }: { initialUser?: User }) {
    const pathname = usePathname() ?? '';
    const router = useRouter();

    const isMatch = (href: string) => pathname === href || pathname.startsWith(href + '/');

    const [user, setUser] = useState<User>(initialUser ?? null);
    const [links, setLinks] = useState<NavItem[]>(baseLinks);

    useEffect(() => {
        // Si viene initialUser desde el server (layout), úsalo
        if (initialUser) {
            setUser(initialUser);
            buildLinks(initialUser);
            return;
        }

        let mounted = true;
        fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => {
                if (!mounted) return;
                if (j?.success) {
                    setUser(j.user);
                    buildLinks(j.user);
                } else {
                    setUser(null);
                    buildLinks(null);
                }
            })
            .catch(() => {
                if (mounted) {
                    setUser(null);
                    buildLinks(null);
                }
            });

        return () => { mounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialUser]);

    function buildLinks(u: User | null) {
        // empezamos con el conjunto base
        let out: NavItem[] = [...baseLinks];

        const role = (u?.role ?? '').toString().toUpperCase();
        const isSuperAdmin = role === 'SUPERADMIN';
        const isOperador = role === 'OPERADOR';

        // Si es OPERADOR -> quitar la opción "/cosecha"
        if (isOperador) {
            out = out.filter((item) => item.href !== '/cosecha');
        }

        // "Solicitudes" → SOLO SUPERADMIN
        if (u && isSuperAdmin) {
            out.push({ href: '/edit-requests', label: 'Solicitudes', icon: FiMail });
        }

        // "Crear usuario" → SOLO SUPERADMIN
        if (u && isSuperAdmin) {
            out.push({ href: '/users', label: 'Crear usuario', icon: FiUserPlus });
        }

        setLinks(out);
    }

    const handleLogout = async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        } catch {
            /* no-op */
        }
        router.push('/login?logged_out=1');
    };

    return (
        <aside className={styles.wrapper} role="navigation" aria-label="Barra lateral">
            <div className={styles.logoBox}>
                <Image
                    src="/images/logo.png"
                    alt="San Benjamín"
                    width={150}
                    height={150}
                    className={styles.logo}
                    priority
                />
            </div>

            <nav className={styles.group} aria-label="Menú principal">
                {links.map((l) => {
                    const IconComp = (l.icon ?? FiGrid) as IconType;
                    const active = isMatch(l.href);
                    return (
                        <Link
                            key={l.href}
                            href={l.href}
                            className={`${styles.tile} ${active ? styles.active : ''}`}
                            aria-current={active ? 'page' : undefined}
                            aria-label={l.label}
                        >
                            <div className={styles.iconWrap}>
                                <IconComp className={styles.icon} aria-hidden />
                            </div>
                            <div className={styles.textWrap}>
                                <span className={styles.label}>{l.label}</span>
                            </div>
                        </Link>
                    );
                })}
            </nav>

            <div className={styles.bottom}>
                <button
                    onClick={handleLogout}
                    className={styles.tile}
                    aria-label="Salir"
                    style={{ border: 'none', background: 'transparent', width: '100%', textAlign: 'left', cursor: 'pointer' }}
                >
                    <div className={styles.iconWrap}>
                        <FiLogOut className={styles.icon} />
                    </div>
                    <div className={styles.textWrap}>
                        <span className={styles.label}>Salir</span>
                    </div>
                </button>
            </div>
        </aside>
    );
}
