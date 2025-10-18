// app/(app)/catalogs/page.tsx
import Link from 'next/link';
import styles from './catalogs.module.css';
import { FiTruck, FiGrid } from 'react-icons/fi';
import * as GiIcons from 'react-icons/gi';
import { FaSwimmingPool, FaMapMarkerAlt } from 'react-icons/fa';
import { BiImage, BiCube } from 'react-icons/bi';

const cards = [
    { href: '/catalogs/providers',  label: 'Proveedores',    Icon: FiTruck,        type: 'providers', desc: 'Registro y gestión de proveedores' },
    { href: '/catalogs/pools',      label: 'Piscinas',      Icon: FaSwimmingPool, type: 'pools',     desc: 'Piscinas / estanques' },
    { href: '/catalogs/lotes',      label: 'Lotes',         Icon: FaMapMarkerAlt, type: 'lots',      desc: 'Lotes productivos' },
    { href: '/catalogs/food-types', label: 'Tipos alimento',Icon: FiGrid,         type: 'food',      desc: 'Categorías de alimento' },
    { href: '/catalogs/details',    label: 'Detalle',       Icon: BiImage,        type: 'details',   desc: 'Presentaciones y detalle' },
    { href: '/catalogs/packages',   label: 'Paquetes',      Icon: BiCube,         type: 'packages',  desc: 'Tipos de empaquetado' },
];

export default function CatalogsPage() {
    return (
        <div className={styles.wrap}>
            <div className={styles.grid}>
                {cards.map(({ href, label, Icon, type, desc }, i) => {
                    // fallback seguro: si Icon es undefined usamos FiGrid
                    const IconComp = (Icon ?? FiGrid) as React.ComponentType<any>;
                    return (
                        <Link
                            key={href}
                            href={href}
                            className={styles.card}
                            data-type={type}
                            aria-label={label}
                            style={{ animationDelay: `${i * 70}ms` }}
                        >
                            <div className={styles.icon} aria-hidden>
                                <IconComp size={34} />
                            </div>

                            <div className={styles.content}>
                                <div className={styles.label}>{label}</div>
                                <div className={styles.desc}>{desc}</div>
                            </div>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
