'use client';

import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import styles from './edit-requests.module.css';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import { FiRefreshCw, FiCheckCircle, FiXCircle, FiSearch, FiMail } from 'react-icons/fi';

type Scope = 'edicion' | 'inactivacion';

const ENDPOINTS: Record<Scope, { base: string; title: string; noun: string }> = {
    edicion: { base: '/api/edit-requests',         title: 'Solicitudes de edición',         noun: 'edición' },
    inactivacion: { base: '/api/inactivation-requests', title: 'Solicitudes de inactivación', noun: 'inactivación' },
};

type ReqRow = {
    id: number;
    tabla: string;
    registro_id: number;
    operador_id: number;
    operador_nombre?: string | null;
    operador_email?: string | null;
    motivo: string;
    estado: string;
    creado_en?: string;
};

const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3500,
    background: '#fff',
    timerProgressBar: true,
});

export default function RequestsUnifiedPage() {
    const [role, setRole] = useState<string | null>(null);
    const [roleResolved, setRoleResolved] = useState(false);
    const isSuper = (role ?? '').toUpperCase() === 'SUPERADMIN';

    // scope seleccionado (edición / inactivación)
    const [scope, setScope] = useState<Scope>('edicion');

    const [data, setData] = useState<ReqRow[]>([]);
    const [loadingList, setLoadingList] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);

    // búsqueda (server-side) con debounce
    const [q, setQ] = useState('');
    const [debouncedQ, setDebouncedQ] = useState('');

    // paginación (server-side)
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [pages, setPages] = useState(1);

    // refresco manual
    const [refreshToken, setRefreshToken] = useState(0);

    // modal rechazo
    const [rejectModal, setRejectModal] = useState<{ open: boolean; row?: ReqRow; scope?: Scope }>({ open: false });

    // abort controller para fetchList
    const abortRef = useRef<AbortController | null>(null);

    // 1) Resolver usuario
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const r = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
                const j = await r.json().catch(() => null);
                if (!mounted) return;
                setRole((j?.user?.role ?? '').toString().toUpperCase());
            } catch {
                if (mounted) setRole(null);
            } finally {
                if (mounted) setRoleResolved(true);
            }
        })();
        return () => { mounted = false; };
    }, []);

    // 2) Debounce de q
    useEffect(() => {
        const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
        return () => clearTimeout(t);
    }, [q]);

    // si cambia query o scope, vuelve a página 1
    useEffect(() => { setPage(1); }, [debouncedQ, scope]);

    // 3) Carga de la lista
    useEffect(() => {
        if (!roleResolved) return;
        if (!isSuper) {
            setData([]);
            setInitialLoading(false);
            return;
        }
        void fetchList({ initial: initialLoading });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roleResolved, isSuper, page, pageSize, debouncedQ, refreshToken, scope]);

    async function fetchList({ initial = false }: { initial?: boolean } = {}) {
        if (abortRef.current) abortRef.current.abort();
        const ac = new AbortController();
        abortRef.current = ac;

        if (initial) setInitialLoading(true);
        setLoadingList(!initial);

        try {
            const params = new URLSearchParams({
                page: String(page),
                pageSize: String(pageSize),
            });
            if (debouncedQ) params.set('q', debouncedQ);

            const res = await fetch(`${ENDPOINTS[scope].base}?${params.toString()}`, {
                cache: 'no-store',
                credentials: 'same-origin',
                signal: ac.signal,
            });
            const json = await res.json();
            if (json?.success) {
                setData(json.data || []);
                setTotal(Number(json.total ?? 0));
                setPages(Math.max(1, Number(json.pages ?? 1)));
            } else {
                setData([]); setTotal(0); setPages(1);
                Toast.fire({ icon: 'error', title: json?.msg || 'Error cargando solicitudes' });
            }
        } catch (e: any) {
            if (e?.name !== 'AbortError') {
                console.error(e);
                setData([]); setTotal(0); setPages(1);
                Toast.fire({ icon: 'error', title: 'Error cargando solicitudes' });
            }
        } finally {
            setInitialLoading(false);
            setLoadingList(false);
            abortRef.current = null;
        }
    }

    async function onApprove(row: ReqRow) {
        const noun = ENDPOINTS[scope].noun; // edición / inactivación
        const ok = await Swal.fire({
            title: `Aprobar solicitud de ${noun}`,
            html: `¿Aprobar la solicitud para <b>${row.tabla}</b> del operador <b>${row.operador_nombre ?? '—'}</b>?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, aprobar',
            cancelButtonText: 'Cancelar',
            focusCancel: true,
            reverseButtons: true,
        });
        if (!ok.isConfirmed) return;

        try {
            const res = await fetch(`${ENDPOINTS[scope].base}/${row.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ action: 'approve' }),
            });
            const json = await res.json();
            if (json?.success) {
                Toast.fire({ icon: 'success', title: 'Aprobada. Código enviado al operador.' });
                setRefreshToken(t => t + 1);
            } else {
                Toast.fire({ icon: 'error', title: json?.msg || 'Error' });
            }
        } catch {
            Toast.fire({ icon: 'error', title: 'Error del servidor' });
        }
    }

    function onReject(row: ReqRow) { setRejectModal({ open: true, row, scope }); }
    function closeReject() { setRejectModal({ open: false, row: undefined, scope: undefined }); }

    async function doReject(id: number, comment: string, sc: Scope) {
        try {
            const res = await fetch(`${ENDPOINTS[sc].base}/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ action: 'reject', comment }),
            });
            const json = await res.json();
            if (json?.success) {
                Toast.fire({ icon: 'success', title: 'Solicitud rechazada y notificada.' });
                setRefreshToken(t => t + 1);
                closeReject();
            } else {
                Toast.fire({ icon: 'error', title: json?.msg || 'Error' });
            }
        } catch {
            Toast.fire({ icon: 'error', title: 'Error del servidor' });
        }
    }

    // Estados derivados
    const canPrev = page > 1;
    const canNext = page < pages;
    const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const to = (page - 1) * pageSize + data.length;

    // ===== Render =====

    // A) Resolviendo rol
    if (!roleResolved) {
        return (
            <div className={styles.wrap}>
                <div className={styles.controls}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <div className={`${styles.searchBox} ${styles.skeleton}`}>
                            <div className={`${styles.skelIcon} ${styles.shimmer}`} />
                            <div className={`${styles.skelInput} ${styles.shimmer}`} />
                        </div>
                        <div className={`${styles.psizeSelect} ${styles.skeleton} ${styles.shimmer}`} style={{ width: 220, height: 32 }} />
                    </div>
                </div>

                <div className={styles.tableCard}>
                    <div className={styles.headerRow}>
                        <div className={`${styles.title} ${styles.skeleton} ${styles.shimmer}`} style={{ width: 260, height: 20 }} />
                    </div>
                    <TableSkeleton rows={8} />
                </div>
            </div>
        );
    }

    // B) No autorizado
    if (!isSuper) {
        return (
            <div className={styles.wrap}>
                <div className={styles.controls}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <div className={styles.searchBox} style={{ opacity: 0.65, pointerEvents: 'none' }}>
                            <FiSearch className={styles.searchIcon} />
                            <input className={styles.searchInput} placeholder="Buscar…" value={q} readOnly />
                        </div>
                    </div>
                </div>

                <div className={styles.tableCard}>
                    <div className={styles.infoCard}>
                        <div className={styles.infoIcon}><FiMail /></div>
                        <div className={styles.infoBody}>
                            <div className={styles.infoTitle}>No autorizado</div>
                            <div className={styles.infoText}>Esta sección es solo para administradores.</div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // C) Superadmin
    const title = ENDPOINTS[scope].title;

    return (
        <div className={styles.wrap}>
            {/* Controles */}
            <div className={styles.controls}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Selector de tipo */}
                    <label className={styles.psizeLabel}>
                        Ver
                        <select
                            className={styles.psizeSelect}
                            value={scope}
                            onChange={(e) => { setScope(e.target.value as Scope); }}
                        >
                            <option value="edicion">Solicitudes de edición</option>
                            <option value="inactivacion">Solicitudes de inactivación</option>
                        </select>
                    </label>

                    <div className={styles.searchBox}>
                        <FiSearch className={styles.searchIcon} />
                        <input
                            className={styles.searchInput}
                            placeholder="Buscar por tabla, motivo, operador, estado"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            aria-label="Buscar solicitudes"
                        />
                    </div>

                    {/* tamaño de página */}
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
                </div>

                <div className={styles.actionButtons}>
          <span className={styles.counter}>
            {initialLoading && total === 0 ? '—' : `${from}–${to} de ${total}`}
          </span>
                    <button
                        className={styles.iconButton}
                        title="Actualizar"
                        onClick={() => setRefreshToken(t => t + 1)}
                        aria-label="Actualizar lista"
                    >
                        <FiRefreshCw />
                    </button>
                </div>
            </div>

            <div className={styles.tableCard}>
                <div className={styles.headerRow}>
                    <h2 className={styles.title}>{title}</h2>
                </div>

                {initialLoading ? (
                    <TableSkeleton rows={10} />
                ) : (
                    <>
                        <table className={styles.table}>
                            <thead>
                            <tr>
                                <th>Tabla</th>
                                <th style={{ minWidth: 360 }}>Motivo</th>
                                <th>Operador</th>
                                <th>Estado</th>
                                <th>Creado</th>
                                <th aria-hidden />
                            </tr>
                            </thead>
                            <tbody>
                            {data.length === 0 ? (
                                <tr><td colSpan={6} className={styles.emptyRow}>Sin registros</td></tr>
                            ) : (
                                data.map(r => {
                                    const isPending = (r.estado ?? '').toUpperCase() === 'PENDIENTE';
                                    return (
                                        <tr key={r.id} className={loadingList ? styles.rowDim : undefined}>
                                            <td className={styles.cell}>{r.tabla}</td>
                                            <td className={styles.cell} style={{ maxWidth: 520, whiteSpace: 'pre-wrap' }}>{r.motivo}</td>
                                            <td className={styles.cell}>
                                                <div>{r.operador_nombre ?? '—'}</div>
                                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.operador_email ?? ''}</div>
                                            </td>
                                            <td className={styles.cellCenter}>{r.estado}</td>
                                            <td className={styles.cell}>{r.creado_en ? new Date(r.creado_en).toLocaleString() : '—'}</td>
                                            <td className={styles.cellActions}>
                                                <button
                                                    className={styles.smallBtnPrimary}
                                                    title="Aprobar"
                                                    onClick={() => onApprove(r)}
                                                    disabled={!isPending}
                                                >
                                                    <FiCheckCircle />
                                                    <span style={{ marginLeft: 6 }}>Aprobar</span>
                                                </button>

                                                <button
                                                    className={styles.smallBtnDanger}
                                                    title="Rechazar"
                                                    onClick={() => onReject(r)}
                                                    disabled={!isPending}
                                                >
                                                    <FiXCircle />
                                                    <span style={{ marginLeft: 6 }}>Rechazar</span>
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                            {loadingList && data.length > 0 && (
                                [...Array(Math.min(5, Math.max(0, pageSize - data.length)))].map((_, i) => (
                                    <SkeletonRow key={`sk-row-${i}`} colSpan={6} />
                                ))
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

            {rejectModal.open && rejectModal.row && (
                <RejectModal
                    row={rejectModal.row}
                    scope={rejectModal.scope!}
                    onCancel={closeReject}
                    onConfirm={(id, comment) => doReject(id, comment, rejectModal.scope!)}
                />
            )}
        </div>
    );
}

/* ===== Skeleton helpers ===== */
function TableSkeleton({ rows = 8 }: { rows?: number }) {
    return (
        <table className={styles.table}>
            <thead>
            <tr>
                <th>Tabla</th>
                <th style={{ minWidth: 360 }}>Motivo</th>
                <th>Operador</th>
                <th>Estado</th>
                <th>Creado</th>
                <th aria-hidden />
            </tr>
            </thead>
            <tbody>
            {Array.from({ length: rows }).map((_, i) => (
                <SkeletonRow key={`sk-${i}`} colSpan={6} />
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
                    <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{ width: '25%' }} />
                    <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{ width: '45%' }} />
                    <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{ width: '20%' }} />
                </div>
            </td>
        </tr>
    );
}

/* ===== Modal Rechazo (portal) ===== */
function RejectModal({
                         row, scope, onCancel, onConfirm,
                     }: { row: ReqRow; scope: Scope; onCancel: () => void; onConfirm: (id: number, comment: string) => void; }) {
    const [mounted, setMounted] = useState(false);
    const [comment, setComment] = useState('');

    useEffect(() => {
        setMounted(true);
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onCancel]);

    const noun = scope === 'edicion' ? 'edición' : 'inactivación';

    const content = (
        <div className={styles.modalOverlay} aria-modal role="dialog" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
            <div className={styles.modal} style={{ maxWidth: 720 }}>
                <h3 className={styles.modalTitle}>Rechazar solicitud de {noun}</h3>

                <div className={styles.mailField}><div className={styles.mailLabel}>Operador</div><div className={styles.mailValue}>{row.operador_nombre ?? '—'}</div></div>
                <div className={styles.mailField}><div className={styles.mailLabel}>Email</div><div className={styles.mailValue}>{row.operador_email ?? '—'}</div></div>
                <div className={styles.mailField}><div className={styles.mailLabel}>Tabla</div><div className={styles.mailValue}>{row.tabla}</div></div>
                <div className={styles.mailField}><div className={styles.mailLabel}>Motivo</div><div className={styles.mailValue}>{row.motivo}</div></div>

                <div className={styles.mailField}>
                    <div className={styles.mailLabel}>Comentario (opcional)</div>
                    <textarea className={styles.input} rows={3} placeholder="Explica por qué se rechaza…" value={comment} onChange={(e) => setComment(e.target.value)} />
                </div>

                <div className={styles.mailBodyBox}>
                    <div className={styles.mailBodyHeader}><FiMail style={{ marginRight: 8 }} />Vista previa</div>
                    <pre className={styles.mailBodyPre}>
{`Hola ${row.operador_nombre ?? ''},

Tu solicitud de ${noun} para un registro de la tabla "${row.tabla}" ha sido rechazada por el administrador.

Resumen:
• Tabla: ${row.tabla}
• Motivo: ${row.motivo}

${comment ? `Motivo del rechazo:\n${comment}\n\n` : ''}Si crees que se trata de un error, crea una nueva solicitud con más detalles.`}
          </pre>
                </div>

                <div className={styles.modalActions}>
                    <button className={styles.btnSecondary} onClick={onCancel}>Cancelar</button>
                    <button className={styles.btnDanger} onClick={() => onConfirm(row.id, comment)}>Rechazar y notificar</button>
                </div>
            </div>
        </div>
    );

    if (!mounted || typeof document === 'undefined' || !document.body) return null;
    return ReactDOM.createPortal(content, document.body);
}
