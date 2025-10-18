// components/ActiveSidebarMarker.tsx
'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import styles from './Sidebar.module.css';

/**
 * Mantiene sincronizado el "activo" del sidebar en navegaciones cliente,
 * sin convertir el Sidebar a Client Component.
 *
 * Busca los links con data-href y setea data-active=true/false según usePathname().
 * Además, agrega/remueve la clase CSS generada por el module (styles.active)
 * para garantizar que sólo un tile tenga la apariencia "activo".
 */
export default function ActiveSidebarMarker() {
    const pathname = usePathname() ?? '/';

    useEffect(() => {
        const tiles = Array.from(
            document.querySelectorAll<HTMLAnchorElement>('aside [data-href]')
        );

        tiles.forEach((el) => {
            const href = el.getAttribute('data-href') || '';
            const active =
                pathname === href ||
                pathname.startsWith(href + '/') ||
                pathname.startsWith(href + '?') ||
                pathname.startsWith(href + '#');

            // 1) atributo (útil para SSR + estilos por atributo)
            el.setAttribute('data-active', active ? 'true' : 'false');

            // 2) sincroniza la clase del CSS module (asegura sólo un .active visible)
            //    Quita la clase si no corresponde; añade si corresponde.
            if (active) {
                el.classList.add(styles.active);
            } else {
                el.classList.remove(styles.active);
            }
        });
    }, [pathname]);

    return null;
}
