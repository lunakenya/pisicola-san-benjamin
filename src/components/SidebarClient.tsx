// components/SidebarClient.tsx
'use client';

import { usePathname } from 'next/navigation';
import SidebarServer from './SidebarServer';

type User = { id: number; role?: string; nombre?: string } | null;

/**
 * Lee el pathname en cliente y se lo pasa al Sidebar del servidor.
 * Así el item activo se pinta al instante en navegaciones client-side.
 */
export default function SidebarClient({ initialUser }: { initialUser: User }) {
    const pathname = usePathname() ?? '/';
    return <SidebarServer initialUser={initialUser} currentPath={pathname} />;
}
