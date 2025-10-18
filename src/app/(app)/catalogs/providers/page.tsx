'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from './providers.module.css';
import { FiRefreshCw, FiPlus, FiSearch, FiEdit2, FiTrash2 } from 'react-icons/fi';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

type Provider = { id: number; nombre: string; ruc: string | null; active: boolean };

/* Toast helper */
const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 4000,
    timerProgressBar: true,
    background: '#fff',
});

/* helper para parsear respuestas y adjuntar status al Error */
async function parseResponseOrThrow(res: Response) {
    const json = await res.json().catch(() => null);
    if (res.ok) return json;
    const msg = json?.msg || res.statusText || 'Error del servidor';
    const err = new Error(msg) as any;
    err.status = res.status;
    err.json = json;
    throw err;
}

/* ===========================
   Modal de Crear / Editar
   =========================== */
function ProviderFormModal({
                               open,
                               initial,
                               onClose,
                               onSaved,
                           }: {
    open: boolean;
    initial?: Partial<Provider>;
    onClose: () => void;
    onSaved: (p: Provider) => void;
}) {
    const [nombre, setNombre] = useState(initial?.nombre ?? '');
    const [ruc, setRuc] = useState(initial?.ruc ?? '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setNombre(initial?.nombre ?? '');
            setRuc(initial?.ruc ?? '');
            setError(null);
        }
    }, [open, initial]);

    if (!open) return null;
    const isEdit = !!initial?.id;

    const submit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        setError(null);

        if (!nombre.trim()) {
            setError('Nombre requerido');
            return;
        }
        if (ruc && !/^\d+$/.test(ruc)) {
            setError('RUC sólo debe contener números');
            return;
        }

        setLoading(true);
        try {
            if (isEdit && initial?.id) {
                const res = await fetch(`/api/providers/${initial.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre: nombre.trim(), ruc: ruc?.trim() || '' }),
                });
                const json = await parseResponseOrThrow(res);
                onSaved(json.data);
                Toast.fire({ icon: 'success', title: 'Proveedor actualizado' });
            } else {
                const res = await fetch(`/api/providers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre: nombre.trim(), ruc: ruc?.trim() || '' }),
                });
                const json = await parseResponseOrThrow(res);
                onSaved(json.data);
                Toast.fire({ icon: 'success', title: 'Proveedor creado' });
            }
            onClose();
        } catch (err: any) {
            if (err?.status === 409) {
                setError(err.message || 'Nombre o RUC en uso por otro activo.');
            } else {
                setError(err?.message ?? 'Error en servidor');
                Toast.fire({ icon: 'error', title: err?.message ?? 'Error en servidor' });
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
            <form className={styles.modal} onSubmit={submit}>
                <h3 className={styles.modalTitle}>{isEdit ? 'Editar proveedor' : 'Nuevo proveedor'}</h3>

                <label className={styles.formLabel}>
                    Nombre
                    <input className={styles.input} value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus required />
                </label>

                <label className={styles.formLabel}>
                    RUC
                    <input
                        className={styles.input}
                        value={ruc ?? ''}
                        onChange={(e) => setRuc(e.target.value.replace(/\D/g, ''))}
                        inputMode="numeric"
                        pattern="\d*"
                        placeholder="Solo números (opcional)"
                    />
                </label>

                {error && <div className={styles.formError}>{error}</div>}

                <div className={styles.modalActions}>
                    <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={loading}>Cancelar</button>
                    <button type="submit" className={styles.btnPrimary} disabled={loading}>
                        {loading ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear proveedor'}
                    </button>
                </div>
            </form>
        </div>
    );
}

/* ===========================
   Skeletons
   =========================== */
function TableSkeleton({ rows = 10 }: { rows?: number }) {
    return (
        <table className={styles.table}>
            <thead>
            <tr>
                <th>Nombre</th>
                <th>RUC</th>
                <th>Activo</th>
                <th aria-hidden />
            </tr>
            </thead>
            <tbody>
            {Array.from({ length: rows }).map((_, i) => (
                <SkeletonRow key={`sk-${i}`} colSpan={5} />
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
                    <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{ width: '30%' }} />
                    <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{ width: '20%' }} />
                    <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{ width: '10%' }} />
                    <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{ width: '12%' }} />
                </div>
            </td>
        </tr>
    );
}

/* ===========================
   Página principal
   =========================== */
export default function ProvidersPage() {
    const [data, setData] = useState<Provider[]>([]);
    const [initialLoading, setInitialLoading] = useState(true);
    const [loadingList, setLoadingList] = useState(false);

    // búsqueda server-side con debounce
    const [q, setQ] = useState('');
    const [debouncedQ, setDebouncedQ] = useState('');

    // paginación server-side
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [pages, setPages] = useState(1);

    // filtros
    const [showInactive, setShowInactive] = useState(false);

    // modal
    const [openForm, setOpenForm] = useState(false);
    const [formInitial, setFormInitial] = useState<Partial<Provider> | undefined>(undefined);

    // controlar abort de fetch en vuelo
    const abortRef = useRef<AbortController | null>(null);

    // debounce de q
    useEffect(() => {
        const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
        return () => clearTimeout(t);
    }, [q]);

    // si cambian q o showInactive → volver a página 1
    useEffect(() => { setPage(1); }, [debouncedQ, showInactive]);

    // cargar lista
    useEffect(() => { void fetchData({ initial: initialLoading }); /* eslint-disable-next-line */ }, [page, pageSize, debouncedQ, showInactive]);

    async function fetchData({ initial = false }: { initial?: boolean } = {}) {
        // cancelar llamada previa si existe
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

            const url = `/api/providers?${params.toString()}`;
            const res = await fetch(url, { cache: 'no-store', signal: ac.signal });
            const json = await res.json();

            if (json?.success) {
                setData(json.data ?? []);
                setTotal(Number(json.total ?? 0));
                setPages(Math.max(1, Number(json.pages ?? 1)));
            } else {
                setData([]);
                setTotal(0);
                setPages(1);
                Toast.fire({ icon: 'error', title: json?.msg ?? 'Error al cargar' });
            }
        } catch (e: any) {
            if (e?.name !== 'AbortError') {
                console.error(e);
                setData([]); setTotal(0); setPages(1);
                Toast.fire({ icon: 'error', title: 'Error cargando proveedores' });
            }
        } finally {
            setInitialLoading(false);
            setLoadingList(false);
            abortRef.current = null;
        }
    }

    // abrir/editar
    const onCreate = () => { setFormInitial(undefined); setOpenForm(true); };
    const onEdit = (p: Provider) => { setFormInitial(p); setOpenForm(true); };

    // tras crear/editar → refrescar lista manteniendo paginación/filtros
    const onSaved = (p: Provider) => {
        // estrategia simple: recargar página actual para mantener conteos consistentes
        void fetchData();
    };

    // inactivar/restaurar
    const onAskToggleActive = async (p: Provider) => {
        const action = p.active ? 'Inactivar' : 'Restaurar';
        const result = await Swal.fire({
            title: `${action} proveedor`,
            html: p.active
                ? `¿Inactivar al proveedor "<b>${p.nombre}</b>"?`
                : `¿Restaurar al proveedor "<b>${p.nombre}</b>"?`,
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
                const res = await fetch(`/api/providers/${p.id}`, { method: 'DELETE' });
                await parseResponseOrThrow(res);
                Toast.fire({ icon: 'success', title: `Proveedor "${p.nombre}" inactivado` });
            } else {
                const res = await fetch(`/api/providers/${p.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ active: true }),
                });
                await parseResponseOrThrow(res);
                Toast.fire({ icon: 'success', title: `Proveedor "${p.nombre}" restaurado` });
            }
            // Mantener UX consistente con server-side paging
            void fetchData();
        } catch (e: any) {
            console.error(e);
            Toast.fire({ icon: 'error', title: e?.message ?? 'Error del servidor' });
        }
    };

    // derivados para contador
    const canPrev = page > 1;
    const canNext = page < pages;
    const from = useMemo(() => (total === 0 ? 0 : (page - 1) * pageSize + 1), [page, pageSize, total]);
    const to = useMemo(() => (page - 1) * pageSize + data.length, [page, pageSize, data.length]);

    return (
        <div className={styles.wrap}>
            <div className={styles.controls}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div className={styles.searchBox}>
                        <FiSearch className={styles.searchIcon} />
                        <input
                            className={styles.searchInput}
                            placeholder="Buscar por ID, Nombre o RUC"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            aria-label="Buscar proveedores"
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

                    <button className={styles.roundButton} title="Nuevo proveedor" onClick={onCreate} aria-label="Nuevo proveedor">
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
                                <th style={{ width: 220 }}>RUC</th>
                                <th style={{ width: 100 }}>Activo</th>
                                <th style={{ width: 220 }} aria-hidden />
                            </tr>
                            </thead>
                            <tbody>
                            {data.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className={styles.emptyRow}>Sin registros</td>
                                </tr>
                            ) : (
                                data.map((p) => (
                                    <tr key={p.id} className={loadingList ? styles.rowDim : undefined}>
                                        <td className={styles.cell}>{p.nombre}</td>
                                        <td className={styles.cell}>{p.ruc ?? '—'}</td>
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

                            {/* Skeletons de relleno cuando recarga parcial */}
                            {loadingList && data.length > 0 && (
                                [...Array(3)].map((_, i) => <SkeletonRow key={`sk-row-${i}`} colSpan={5} />)
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

            <ProviderFormModal
                open={openForm}
                initial={formInitial}
                onClose={() => setOpenForm(false)}
                onSaved={onSaved}
            />
        </div>
    );
}
