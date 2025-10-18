// Server Component: sin 'use client'
import Link from 'next/link';
import Image from 'next/image';
import styles from './Sidebar.module.css';
import type { IconType } from 'react-icons';
import {
    FiAlertTriangle,
    FiFileText,
    FiBarChart2,
    FiGrid,
    FiLogOut,
    FiMail,
    FiUserPlus,
} from 'react-icons/fi';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import ActiveSidebarMarker from './ActiveSidebarMarker'; // ← micro cliente

type NavItem = { href: string; label: string; icon?: IconType };
type User = { id: number; role?: string; nombre?: string } | null;

// baseLinks incluye /cosecha por defecto; lo filtramos para OPERADOR en buildLinks
const baseLinks: NavItem[] = [
    { href: '/feedings',    label: 'Alimentos',    icon: FiGrid },
    { href: '/losses',      label: 'Bajas',        icon: FiAlertTriangle },
    { href: '/harvests',    label: 'Hoja Cosecha', icon: FiFileText },
    { href: '/cosecha',     label: 'Cosecha',      icon: FiBarChart2 }, // visible salvo para OPERADOR
    { href: '/catalogs',    label: 'Catálogos',    icon: FiGrid },
];

// Acción de servidor: borra cookie y redirige (sin JS)
async function logoutAction() {
    'use server';
    const cookieStore = await cookies();
    cookieStore.delete('auth_token', { path: '/' });
    redirect('/login?logged_out=1');
}

function buildLinks(user: User): NavItem[] {
    let out: NavItem[] = [...baseLinks];

    const role = (user?.role ?? '').toString().toUpperCase();
    const isSuperAdmin = role === 'SUPERADMIN';
    const isOperador = role === 'OPERADOR';

    // Si es OPERADOR -> quitar la opción "/cosecha"
    if (isOperador) {
        out = out.filter((item) => item.href !== '/cosecha');
    }

    // "Solicitudes" y "Crear usuario" → SOLO SUPERADMIN
    if (user && isSuperAdmin) {
        out.push({ href: '/edit-requests', label: 'Solicitudes', icon: FiMail });
        out.push({ href: '/users', label: 'Crear usuario', icon: FiUserPlus });
    }

    return out;
}

export default function SidebarServer({
                                          initialUser,
                                          currentPath,
                                      }: {
    initialUser: User;
    currentPath: string; // p. ej. "/catalogs"
}) {
    const links = buildLinks(initialUser);

    // Activo en SSR: ruta exacta, hija, con query o hash
    const isActive = (href: string) =>
        currentPath === href ||
        currentPath.startsWith(href + '/') ||
        currentPath.startsWith(href + '?') ||
        currentPath.startsWith(href + '#');

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
                    const active = isActive(l.href);

                    return (
                        <Link
                            key={l.href}
                            href={l.href}
                            className={styles.tile}
                            data-href={l.href}
                            data-active={active ? 'true' : 'false'}
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
                <form action={logoutAction}>
                    <button
                        className={styles.tile}
                        aria-label="Salir"
                        style={{
                            border: 'none',
                            background: 'transparent',
                            width: '100%',
                            textAlign: 'left',
                            cursor: 'pointer',
                        }}
                    >
                        <div className={styles.iconWrap}>
                            <FiLogOut className={styles.icon} />
                        </div>
                        <div className={styles.textWrap}>
                            <span className={styles.label}>Salir</span>
                        </div>
                    </button>
                </form>
            </div>

            {/* Micro-cliente que sincroniza el activo en SPA */}
            <ActiveSidebarMarker />
        </aside>
    );
}
