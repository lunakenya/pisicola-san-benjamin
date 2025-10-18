// src/app/(app)/catalogs/packages/page.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import { FiRefreshCw, FiPlus, FiSearch, FiEdit2, FiTrash2 } from 'react-icons/fi';
import styles from './packages.module.css';

type PackageItem = { id: number; nombre: string; active: boolean };

/* Toast */
const Toast = Swal.mixin({
    toast: true, position: 'top-end', showConfirmButton: false, timer: 4000, timerProgressBar: true, background: '#fff',
});

/* helper parse */
async function parseResponseOrThrow(res: Response) {
    const json = await res.json().catch(() => null);
    if (res.ok) return json;
    const msg = json?.msg || res.statusText || 'Error del servidor';
    const err = new Error(msg) as any;
    err.status = res.status; err.json = json;
    throw err;
}

/* ---------- Modal Crear/Editar ---------- */
function PackageFormModal({
                              open, initial, onClose, onSaved,
                          }: {
    open: boolean;
    initial?: Partial<PackageItem>;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [nombre, setNombre] = useState(initial?.nombre ?? '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) { setNombre(initial?.nombre ?? ''); setError(null); }
    }, [open, initial]);

    if (!open) return null;
    const isEdit = !!initial?.id;

    const submit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        setError(null);
        if (!nombre.trim()) { setError('Nombre requerido'); return; }

        setLoading(true);
        try {
            if (isEdit && initial?.id) {
                const res = await fetch(`/api/packages/${initial.id}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre: nombre.trim() }),
                });
                await parseResponseOrThrow(res);
                Toast.fire({ icon: 'success', title: 'Paquete actualizado' });
            } else {
                const res = await fetch(`/api/packages`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre: nombre.trim() }),
                });
                await parseResponseOrThrow(res);
                Toast.fire({ icon: 'success', title: 'Paquete creado' });
            }
            onSaved();
            onClose();
        } catch (err: any) {
            if (err?.status === 409) setError(err.message || 'Nombre en uso o existe inactivo.');
            else {
                setError(err?.message ?? 'Error en servidor');
                Toast.fire({ icon: 'error', title: err?.message ?? 'Error en servidor' });
            }
        } finally { setLoading(false); }
    };

    return (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
            <form className={styles.modal} onSubmit={submit}>
                <h3 className={styles.modalTitle}>{isEdit ? 'Editar paquete' : 'Nuevo paquete'}</h3>

                <label className={styles.formLabel}>
                    Nombre
                    <input className={styles.input} value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
                </label>

                {error && <div className={styles.formError}>{error}</div>}

                <div className={styles.modalActions}>
                    <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={loading}>Cancelar</button>
                    <button type="submit" className={styles.btnPrimary} disabled={loading}>
                        {loading ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear paquete'}
                    </button>
                </div>
            </form>
        </div>
    );
}

/* ---------- Skeletons ---------- */
function TableSkeleton({ rows = 10 }: { rows?: number }) {
    return (
        <table className={styles.table}>
            <thead>
            <tr>
                <th>Nombre</th>
                <th>Activo</th>
                <th aria-hidden />
            </tr>
            </thead>
            <tbody>
            {Array.from({ length: rows }).map((_, i) => (
                <SkeletonRow key={`sk-${i}`} colSpan={3} />
            ))}
            </tbody>
        </table>
    );
}
function SkeletonRow({ colSpan }: { colSpan: number }) {
    return (
        <tr>
            <td colSpan={colSpan} className={styles.cell}>
                <div className={styles.skelRow}>
                    <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{ width: '40%' }} />
                    <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{ width: '12%' }} />
                    <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{ width: '18%' }} />
                </div>
            </td>
        </tr>
    );
}

/* ---------- Página Paquetes ---------- */
export default function PackagesPage() {
    const [data, setData] = useState<PackageItem[]>([]);
    const [initialLoading, setInitialLoading] = useState(true);
    const [loadingList, setLoadingList] = useState(false);

    const [q, setQ] = useState('');
    const [debouncedQ, setDebouncedQ] = useState('');

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [pages, setPages] = useState(1);

    const [showInactive, setShowInactive] = useState(false);

    const [openForm, setOpenForm] = useState(false);
    const [formInitial, setFormInitial] = useState<Partial<PackageItem> | undefined>(undefined);

    const abortRef = useRef<AbortController | null>(null);

    // debounce
    useEffect(() => {
        const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
        return () => clearTimeout(t);
    }, [q]);

    // reset page on filters
    useEffect(() => { setPage(1); }, [debouncedQ, showInactive]);

    // fetch
    useEffect(() => { void fetchData({ initial: initialLoading }); /* eslint-disable-next-line */ }, [page, pageSize, debouncedQ, showInactive]);

    async function fetchData({ initial = false }: { initial?: boolean } = {}) {
        if (abortRef.current) abortRef.current.abort();
        const ac = new AbortController();
        abortRef.current = ac;

        if (initial) setInitialLoading(true);
        setLoadingList(!initial);

        try {
            const params = new URLSearchParams({
                page: String(page),
                pageSize: String(pageSize),
                includeInactive: showInactive ? 'true' : 'false',
            });
            if (debouncedQ) params.set('q', debouncedQ);

            const url = `/api/packages?${params.toString()}`;
            const res = await fetch(url, { cache: 'no-store', signal: ac.signal });
            const json = await res.json();

            if (json?.success) {
                setData(json.data ?? []);
                setTotal(Number(json.total ?? 0));
                setPages(Math.max(1, Number(json.pages ?? 1)));
            } else {
                setData([]); setTotal(0); setPages(1);
                Toast.fire({ icon: 'error', title: json?.msg ?? 'Error al cargar paquetes' });
            }
        } catch (e: any) {
            if (e?.name !== 'AbortError') {
                console.error(e);
                setData([]); setTotal(0); setPages(1);
                Toast.fire({ icon: 'error', title: 'Error al cargar paquetes' });
            }
        } finally {
            setInitialLoading(false);
            setLoadingList(false);
            abortRef.current = null;
        }
    }

    // crear/editar
    const onCreate = () => { setFormInitial(undefined); setOpenForm(true); };
    const onEdit = (p: PackageItem) => { setFormInitial(p); setOpenForm(true); };
    const onSaved = () => { void fetchData(); };

    // inactivar/restaurar
    const onAskToggleActive = async (p: PackageItem) => {
        const action = p.active ? 'Inactivar' : 'Restaurar';
        const result = await Swal.fire({
            title: `${action} paquete`,
            html: p.active ? `¿Inactivar el paquete "<b>${p.nombre}</b>"?` : `¿Restaurar el paquete "<b>${p.nombre}</b>"?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: action,
            cancelButtonText: 'Cancelar',
            focusCancel: true,
            reverseButtons: true,
        });
        if (!result.isConfirmed) return;

        try {
            if (p.active) {
                const res = await fetch(`/api/packages/${p.id}`, { method: 'DELETE' });
                await parseResponseOrThrow(res);
                Toast.fire({ icon: 'success', title: `Paquete "${p.nombre}" inactivado` });
            } else {
                const res = await fetch(`/api/packages/${p.id}`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ active: true }),
                });
                await parseResponseOrThrow(res);
                Toast.fire({ icon: 'success', title: `Paquete "${p.nombre}" restaurado` });
            }
            void fetchData();
        } catch (e: any) {
            console.error(e);
            Toast.fire({ icon: 'error', title: e?.message ?? 'Error del servidor' });
        }
    };

    // pager helpers
    const canPrev = page > 1;
    const canNext = page < pages;
    const from = useMemo(() => (total === 0 ? 0 : (page - 1) * pageSize + 1), [page, pageSize, total]);
    const to = useMemo(() => (page - 1) * pageSize + data.length, [page, pageSize, data.length]);

    return (
        <div className={styles.wrap}>
            <div className={styles.headerRow}>
                <h2 className={styles.title}>Paquetes</h2>
            </div>

            <div className={styles.controls}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div className={styles.searchBox}>
                        <FiSearch className={styles.searchIcon} />
                        <input
                            className={styles.searchInput}
                            placeholder="Buscar por nombre"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            aria-label="Buscar paquetes"
                        />
                    </div>

                    <label className={styles.psizeLabel}>
                        Mostrar
                        <select
                            className={styles.psizeSelect}
                            value={pageSize}
                            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                        >
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                        por página
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 14 }}>
                        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                        Mostrar inactivos
                    </label>
                </div>

                <div className={styles.actionButtons}>
          <span className={styles.counter}>
            {initialLoading && total === 0 ? '—' : `${from}–${to} de ${total}`}
          </span>

                    <button className={styles.iconButton} title="Actualizar" onClick={() => void fetchData()} aria-label="Actualizar lista">
                        <FiRefreshCw />
                    </button>

                    <button className={styles.roundButton} title="Nuevo paquete" onClick={onCreate} aria-label="Nuevo paquete">
                        <FiPlus />
                    </button>
                </div>
            </div>

            <div className={styles.tableCard}>
                {initialLoading ? (
                    <TableSkeleton rows={10} />
                ) : (
                    <>
                        <table className={styles.table}>
                            <thead>
                            <tr>
                                <th>Nombre</th>
                                <th style={{ width: 120 }}>Activo</th>
                                <th style={{ width: 220 }} aria-hidden />
                            </tr>
                            </thead>

                            <tbody>
                            {data.length === 0 ? (
                                <tr>
                                    <td colSpan={3} className={styles.emptyRow}>Sin registros</td>
                                </tr>
                            ) : (
                                data.map((p) => (
                                    <tr key={p.id} className={loadingList ? styles.rowDim : undefined}>
                                        <td className={styles.cell}>{p.nombre}</td>
                                        <td className={styles.cellCenter}>{p.active ? 'Sí' : 'No'}</td>
                                        <td className={styles.cellActions}>
                                            <button className={styles.smallBtn} title="Editar" onClick={() => onEdit(p)} aria-label={`Editar ${p.nombre}`}>
                                                <FiEdit2 />
                                                <span style={{ marginLeft: 6 }}>Editar</span>
                                            </button>

                                            <button
                                                className={styles.smallBtnAlt}
                                                title={p.active ? 'Inactivar' : 'Restaurar'}
                                                onClick={() => onAskToggleActive(p)}
                                            >
                                                <FiTrash2 />
                                                <span style={{ marginLeft: 6 }}>{p.active ? 'Inactivar' : 'Restaurar'}</span>
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}

                            {loadingList && data.length > 0 && (
                                [...Array(3)].map((_, i) => <SkeletonRow key={`sk-row-${i}`} colSpan={3} />)
                            )}
                            </tbody>
                        </table>

                        {/* Paginación */}
                        <div className={styles.pager}>
                            <button className={styles.pagerBtn} onClick={() => setPage(1)} disabled={!canPrev} aria-label="Primera página">«</button>
                            <button className={styles.pagerBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={!canPrev} aria-label="Anterior">‹</button>

                            <span className={styles.pagerStatus}>
                Página
                <input
                    className={styles.pagerInput}
                    value={page}
                    onChange={(e) => {
                        const v = Number(e.target.value.replace(/\D/g, '')) || 1;
                        setPage(Math.min(Math.max(1, v), pages));
                    }}
                    onBlur={() => setPage(p => Math.min(Math.max(1, p), pages))}
                />
                de {pages}
              </span>

                            <button className={styles.pagerBtn} onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={!canNext} aria-label="Siguiente">›</button>
                            <button className={styles.pagerBtn} onClick={() => setPage(pages)} disabled={!canNext} aria-label="Última página">»</button>
                        </div>
                    </>
                )}
            </div>

            <PackageFormModal open={openForm} initial={formInitial} onClose={() => setOpenForm(false)} onSaved={onSaved} />
        </div>
    );
}
