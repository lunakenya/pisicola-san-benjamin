'use client';

import React, { useCallback, useEffect, useRef, useState, forwardRef } from 'react';
import dynamic from 'next/dynamic';
import AsyncSelect from 'react-select/async';
import styles from './losses.module.css';
import { FiRefreshCw, FiPlus, FiSearch, FiEdit2, FiTrash2, FiKey, FiCalendar } from 'react-icons/fi';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

const DatePicker = dynamic(() => import('react-datepicker'), { ssr: false });
if (typeof window !== 'undefined') {
    require('react-datepicker/dist/react-datepicker.css');
}

import { registerLocale } from 'react-datepicker';
import es from 'date-fns/locale/es';

/* ========= Constantes y Tipos ========= */
const ENDPOINTS = {
    edicion: { base: '/api/edit-requests' },
    inactivacion: { base: '/api/inactivation-requests' },
} as const;

const CODE_LENGTH = 4 as const;

type Loss = {
    id: number;
    lote_id?: number;
    lote_nombre?: string | null;
    piscina_id?: number;
    piscina_nombre?: string | null;
    fecha: string;     // YYYY-MM-DD (backend)
    muertos: number;
    faltantes: number;
    sobrantes: number;
    deformes: number;
    mes?: number;
    active?: boolean;
};

type PendingInfo = {
    pending: boolean;
    request?: { id: number; hasCode: boolean; estado?: string; expiresAt?: string | null; };
} | null;

type Scope = 'edicion' | 'inactivacion';
type InactAction = 'INACTIVAR' | 'RESTAURAR';

type SummaryData = {
    lote_id: number;
    lote_nombre: string;
    total_muertos: number;
    total_faltantes: number;
    total_sobrantes: number;
    total_deformes: number;
};

type GrandTotals = {
    total_muertos: number;
    total_faltantes: number;
    total_sobrantes: number;
    total_deformes: number;
    total_registros: number;
};

const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 4000,
    timerProgressBar: true,
    background: '#fff',
});

/* ========= Helpers ========= */
async function parseResponseOrThrow(res: Response) {
    const json = await res.json().catch(() => null);
    if (res.ok) return json;
    const msg = json?.msg || res.statusText || 'Error del servidor';
    const err = new Error(msg) as any;
    err.status = res.status;
    err.json = json;
    throw err;
}

function buildSummaryText(item?: Loss | null) {
    if (!item) return '';
    const lines = [];
    lines.push(`ID: ${item.id}`);
    lines.push(`Fecha: ${item.fecha ?? '—'}`);
    lines.push(`Lote: ${item.lote_nombre ?? (item.lote_id ? `Lote ${item.lote_id}` : '—')}`);
    lines.push(`Piscina: ${item.piscina_nombre ?? (item.piscina_id ? `Piscina ${item.piscina_id}` : '—')}`);
    lines.push(`Muertos: ${item.muertos ?? 0}`);
    lines.push(`Faltantes: ${item.faltantes ?? 0}`);
    lines.push(`Sobrantes: ${item.sobrantes ?? 0}`);
    lines.push(`Deformes: ${item.deformes ?? 0}`);
    return lines.join('\n');
}

/** Parsea seguro una fecha del API `YYYY-MM-DD` evitando desfases de zona horaria */
function parseAPIDate(dateStr?: string): Date | null {
    if (!dateStr) return null;
    const base = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T12:00:00Z` : dateStr;
    const d = new Date(base);
    return Number.isNaN(d.getTime()) ? null : d;
}
/** Nombre de mes desde número (1-12 ó 0-11) */
function monthNameFromNumber(n?: number | null) {
    const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    if (n == null) return null;
    if (n >= 1 && n <= 12) return months[n - 1];
    if (n >= 0 && n <= 11) return months[n];
    return null;
}
function monthNameFromDate(dateStr?: string) {
    const d = parseAPIDate(dateStr);
    return d ? d.toLocaleString('es-EC', { month: 'long' }) : null;
}

/* 🔧 CAMBIO: normalizamos `estado` con trim().toUpperCase() */
async function fetchPending(registro_id: number, scope: Scope): Promise<PendingInfo> {
    try {
        const base = ENDPOINTS[scope].base;
        const res = await fetch(`${base}/pending?tabla=bajas&registro_id=${registro_id}`, {
            cache: 'no-store',
            credentials: 'same-origin',
        });
        const j: any = await res.json().catch(() => null);
        if (!j?.success) return { pending: !!j?.pending, request: undefined };

        const estadoNorm = (j?.request?.estado ?? '')
            .toString()
            .trim()
            .toUpperCase();

        const hasCode = j?.request?.hasCode ?? (estadoNorm === 'APROBADO');

        return {
            pending: !!j.pending,
            request: j.request
                ? {
                    id: j.request.id,
                    hasCode,
                    estado: estadoNorm,
                    expiresAt: j.request.expiresAt ?? j.request.codigo_expira_en ?? null
                }
                : undefined,
        };
    } catch {
        return null;
    }
}

/* Helper para leer claro el estado */
const isRejected = (p?: PendingInfo) =>
    (p?.request?.estado ?? '').toString().trim().toUpperCase() === 'RECHAZADO';

/* Input para DatePicker con ícono (usa tu CSS local) */
const CustomDateInput = forwardRef<HTMLInputElement, any>(({ value, onClick, placeholder, ...rest }, ref) => (
    <div className={styles.dateWrapper}>
        <input
            {...rest}
            ref={ref}
            className={styles.dateInput}
            value={value ?? ''}
            onClick={onClick}
            readOnly
            placeholder={placeholder}
        />
        <FiCalendar className={styles.dateIcon} />
    </div>
));
CustomDateInput.displayName = 'CustomDateInput';

/* =========================== Página principal =========================== */
export default function LossesPage() {
    const [data, setData] = useState<Loss[]>([]);
    const [initialLoading, setInitialLoading] = useState(true);
    const [loadingList, setLoadingList] = useState(false);

    const [fechaDesde, setFechaDesde] = useState<Date | null>(null);
    const [fechaHasta, setFechaHasta] = useState<Date | null>(null);
    const [selectedMonth, setSelectedMonth] = useState<string>('');

    const [q, setQ] = useState('');
    const [debouncedQ, setDebouncedQ] = useState('');
    const [showInactive, setShowInactive] = useState(false);

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [pages, setPages] = useState(1);

    const [summary, setSummary] = useState<SummaryData[]>([]);
    const [totals, setTotals] = useState<GrandTotals | null>(null);
    const [loadingSummary, setLoadingSummary] = useState(true);

    const [userRole, setUserRole] = useState<string | null>(null);
    const [unlockedEditId, setUnlockedEditId] = useState<number | null>(null);

    const [requestModal, setRequestModal] = useState<{ open: boolean; registro_id?: number; presetMotivo?: string; scope?: Scope; inactAction?: InactAction }>({ open: false });
    const [codeModal, setCodeModal] = useState<{ open: boolean; requestId?: number; registro_id?: number; actionLabel?: string; scope?: Scope; onVerified?: () => Promise<void> }>({ open: false });
    const [editModal, setEditModal] = useState<{ open: boolean; initial?: Loss }>({ open: false });

    const abortRef = useRef<AbortController | null>(null);

    const formatDateParam = (date: Date | null) =>
        date ? new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString().split('T')[0] : '';

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
        return () => clearTimeout(t);
    }, [q]);

    useEffect(() => { setPage(1); }, [debouncedQ, showInactive, fechaDesde, fechaHasta]);

    useEffect(() => {
        registerLocale('es', es);
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        setFechaDesde(start);
        setFechaHasta(end);
        setSelectedMonth(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
        void fetchUser();
    }, []);

    useEffect(() => {
        if (fechaDesde && fechaHasta) {
            void fetchDataAndSummary({ initial: initialLoading });
        }
    }, [page, pageSize, debouncedQ, showInactive, fechaDesde, fechaHasta]); // eslint-disable-line

    const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const monthValue = e.target.value;
        setSelectedMonth(monthValue);
        if (monthValue) {
            const [year, month] = monthValue.split('-').map(Number);
            const startDate = new Date(year, month - 1, 1);
            const endDate = new Date(year, month, 0);
            setFechaDesde(startDate);
            setFechaHasta(endDate);
        } else {
            setFechaDesde(null);
            setFechaHasta(null);
        }
    };

    async function fetchUser() {
        try {
            const r = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
            if (!r.ok) return;
            const j = await r.json();
            if (j?.success) setUserRole((j.user?.role ?? '').toString().toUpperCase());
        } catch {}
    }

    async function fetchDataAndSummary({ initial = false }: { initial?: boolean } = {}) {
        if (abortRef.current) abortRef.current.abort();
        const ac = new AbortController();
        abortRef.current = ac;

        if (initial) { setInitialLoading(true); setLoadingSummary(true); }
        setLoadingList(!initial);
        if (!initial) setLoadingSummary(true);

        const params = new URLSearchParams({
            page: String(page),
            pageSize: String(pageSize),
            includeInactive: showInactive ? 'true' : 'false',
            desde: formatDateParam(fechaDesde),
            hasta: formatDateParam(fechaHasta),
        });
        if (debouncedQ) params.set('q', debouncedQ);

        try {
            const [dataRes, summaryRes] = await Promise.all([
                fetch(`/api/losses?${params.toString()}`, { cache: 'no-store', signal: ac.signal }),
                fetch(`/api/losses/summary?desde=${formatDateParam(fechaDesde)}&hasta=${formatDateParam(fechaHasta)}`, { cache: 'no-store', signal: ac.signal }),
            ]);

            const dataJson = await dataRes.json();
            const summaryJson = await summaryRes.json();

            if (dataJson?.success) {
                setData(dataJson.data ?? []);
                setTotal(Number(dataJson.total ?? 0));
                setPages(Math.max(1, Number(dataJson.pages ?? 1)));
            } else {
                setData([]); setTotal(0); setPages(1);
                Toast.fire({ icon: 'error', title: dataJson?.msg ?? 'Error al cargar registros' });
            }

            if (summaryJson?.success) {
                setSummary(summaryJson.summary ?? []);
                setTotals(summaryJson.totals ?? null);
            } else {
                setSummary([]); setTotals(null);
                Toast.fire({ icon: 'error', title: summaryJson?.msg ?? 'Error al cargar resumen' });
            }
        } catch (e: any) {
            if (e?.name !== 'AbortError') {
                console.error(e);
                setData([]); setTotal(0); setPages(1);
                setSummary([]); setTotals(null);
                Toast.fire({ icon: 'error', title: 'Error cargando datos de bajas' });
            }
        } finally {
            setInitialLoading(false);
            setLoadingList(false);
            setLoadingSummary(false);
            abortRef.current = null;
        }
    }

    const openRequest = (scope: Scope, registro_id?: number, presetMotivo?: string, inactAction?: InactAction) =>
        setRequestModal({ open: true, registro_id, presetMotivo, scope, inactAction });
    const closeRequest = () => setRequestModal({ open: false, registro_id: undefined, presetMotivo: undefined, scope: undefined, inactAction: undefined });
    const openCode = (opts: { requestId: number; registro_id: number; actionLabel: string; scope: Scope; onVerified: () => Promise<void> }) =>
        setCodeModal({ open: true, ...opts });
    const closeCode = () => setCodeModal({ open: false, requestId: undefined, registro_id: undefined, actionLabel: undefined, onVerified: undefined, scope: undefined });
    const onCloseEdit = () => setEditModal({ open: false, initial: undefined });

    // ===== Flujo Editar =====
    const onAskEdit = async (row?: Loss) => {
        const isSuper = (userRole ?? '').toUpperCase() === 'SUPERADMIN';
        const isOperator = (userRole ?? '').toUpperCase() === 'OPERADOR';

        if (!row?.id) { setEditModal({ open: true, initial: undefined }); return; }
        if (isSuper) { setEditModal({ open: true, initial: row }); return; }

        if (isOperator) {
            const pend = await fetchPending(row.id, 'edicion');

            /* 🔧 CAMBIO: usamos helper que compara TRIM + UPPER */
            if (isRejected(pend)) {
                await Swal.fire({
                    icon: 'error',
                    title: 'Solicitud Rechazada',
                    text: 'Tu solicitud anterior para editar este registro fue rechazada por un administrador.',
                    confirmButtonText: 'Entendido, crear nueva solicitud',
                });
                const motivo = `Nueva solicitud de edición - Bajas - Registro ${row.id}`;
                openRequest('edicion', row.id, motivo);
                return;
            }

            if (pend?.pending) {
                if (pend.request?.hasCode) {
                    openCode({
                        requestId: pend.request.id,
                        registro_id: row.id,
                        actionLabel: 'Autorizar edición',
                        scope: 'edicion',
                        onVerified: async () => {
                            setUnlockedEditId(row.id);
                            Toast.fire({ icon: 'success', title: 'Código verificado. Puedes editar.' });
                            const current = data.find(d => d.id === row.id) ?? row;
                            setEditModal({ open: true, initial: current });
                        },
                    });
                } else {
                    Toast.fire({ icon: 'info', title: 'Solicitud pendiente sin código. Espera la aprobación.' });
                }
                return;
            }
            const motivo = `Solicitud de edición - Bajas - Registro ${row.id}`;
            openRequest('edicion', row.id, motivo);
            return;
        }

        Toast.fire({ icon: 'error', title: 'No tienes permisos para editar.' });
    };

    // ===== Flujo Inactivar / Restaurar =====
    const onAskToggleActive = async (row: Loss) => {
        const isSuper = (userRole ?? '').toUpperCase() === 'SUPERADMIN';

        if (isSuper) {
            const action = row.active ? 'Inactivar' : 'Restaurar';
            const result = await Swal.fire({
                title: `${action} registro`,
                html: row.active ? `¿Deseas inactivar el registro <b>${row.id}</b>?` : `¿Deseas restaurar el registro <b>${row.id}</b>?`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: action,
                cancelButtonText: 'Cancelar',
                focusCancel: true,
                reverseButtons: true,
            });
            if (!result.isConfirmed) return;

            try {
                if (row.active) {
                    await fetch(`/api/losses/${row.id}`, { method: 'DELETE', credentials: 'same-origin' }).then(parseResponseOrThrow);
                    Toast.fire({ icon: 'success', title: `Registro ${row.id} inactivado` });
                } else {
                    await fetch(`/api/losses/${row.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({ active: true }),
                    }).then(parseResponseOrThrow);
                    Toast.fire({ icon: 'success', title: `Registro ${row.id} restaurado` });
                }
                await fetchDataAndSummary({});
            } catch (e: any) {
                Toast.fire({ icon: 'error', title: e?.message ?? 'Error del servidor' });
            }
            return;
        }

        const pend = await fetchPending(row.id, 'inactivacion');
        const isRestaurar: InactAction = row.active ? 'INACTIVAR' : 'RESTAURAR';

        /* 🔧 CAMBIO: usamos helper que compara TRIM + UPPER */
        if (isRejected(pend)) {
            await Swal.fire({
                icon: 'error',
                title: 'Solicitud Rechazada',
                text: `Tu solicitud anterior para ${isRestaurar.toLowerCase()} este registro fue rechazada por un administrador.`,
                confirmButtonText: 'Entendido, crear nueva solicitud',
            });
            const motivo = `Nueva solicitud para ${isRestaurar} registro ${row.id} (Bajas).`;
            openRequest('inactivacion', row.id, motivo, isRestaurar);
            return;
        }

        if (pend?.pending) {
            if (pend.request?.hasCode) {
                openCode({
                    requestId: pend.request.id,
                    registro_id: row.id,
                    actionLabel: row.active ? 'Inactivar' : 'Restaurar',
                    scope: 'inactivacion',
                    onVerified: async () => {
                        try {
                            if (row.active) {
                                await fetch(`/api/losses/${row.id}`, { method: 'DELETE', credentials: 'same-origin' }).then(parseResponseOrThrow);
                                Toast.fire({ icon: 'success', title: `Registro ${row.id} inactivado` });
                            } else {
                                await fetch(`/api/losses/${row.id}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    credentials: 'same-origin',
                                    body: JSON.stringify({ active: true }),
                                }).then(parseResponseOrThrow);
                                Toast.fire({ icon: 'success', title: `Registro ${row.id} restaurado` });
                            }
                            await fetchDataAndSummary({});
                        } catch (e: any) {
                            Toast.fire({ icon: 'error', title: e?.message ?? 'Error del servidor' });
                        }
                    },
                });
            } else {
                Toast.fire({ icon: 'info', title: 'Solicitud de activación/inactivación pendiente sin código. Espera la aprobación.' });
            }
        } else {
            const motivo = `Solicitud para ${row.active ? 'INACTIVAR' : 'RESTAURAR'} registro ${row.id} (Bajas). Favor autorizar.`;
            openRequest('inactivacion', row.id, motivo, isRestaurar);
        }
    };

    async function submitRequest(scope: Scope, registro_id: number, motivo: string) {
        try {
            const base = ENDPOINTS[scope].base;
            await fetch(base, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ tabla: 'bajas', registro_id, motivo }),
            }).then(parseResponseOrThrow);
            Toast.fire({ icon: 'success', title: `Solicitud de ${scope === 'edicion' ? 'edición' : 'inactivación/restauración'} enviada` });
            closeRequest();
        } catch (e: any) {
            Toast.fire({ icon: 'error', title: e?.message ?? 'Error enviando solicitud' });
        }
    }

    async function submitEdit(id: number, updates: Partial<Loss>) {
        await fetch(`/api/losses/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(updates),
        }).then(parseResponseOrThrow);
    }

    const canPrev = page > 1;
    const canNext = page < pages;
    const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const to = (page - 1) * pageSize + data.length;

    return (
        <div className={styles.wrap}>

            {/* Filtros */}
            <div className={styles.filtersCard}>
                <div className={styles.filterGroup}>
                    <label className={styles.filterLabel}>Rango de Fechas</label>
                    <div className={styles.dateRangePicker}>
                        <DatePicker
                            selected={fechaDesde}
                            onChange={(date: Date) => { setFechaDesde(date); setSelectedMonth(''); }}
                            selectsStart
                            startDate={fechaDesde}
                            endDate={fechaHasta}
                            dateFormat="dd/MM/yyyy"
                            locale="es"
                            customInput={<CustomDateInput placeholder="Desde" />}
                        />
                        <span className={styles.dateSeparator}>hasta</span>
                        <DatePicker
                            selected={fechaHasta}
                            onChange={(date: Date) => { setFechaHasta(date); setSelectedMonth(''); }}
                            selectsEnd
                            startDate={fechaDesde}
                            endDate={fechaHasta}
                            minDate={fechaDesde ?? undefined}
                            dateFormat="dd/MM/yyyy"
                            locale="es"
                            customInput={<CustomDateInput placeholder="Hasta" />}
                        />
                    </div>
                </div>

                {/* <-- aquí añadimos monthGroup y monthAndActions */}
                <div className={`${styles.filterGroup} ${styles.monthGroup}`}>
                    <label htmlFor="month-select" className={styles.filterLabel}>O seleccionar mes</label>

                    <div className={styles.monthAndActions}>
                        <select
                            id="month-select"
                            value={selectedMonth}
                            onChange={handleMonthChange}
                            className={styles.select}
                        >
                            {[...Array(24)].map((_, i) => {
                                const d = new Date();
                                d.setMonth(d.getMonth() - i);
                                const monthValue = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                                const monthLabel = d.toLocaleString('es-EC', { month: 'long', year: 'numeric' });
                                const label = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
                                return (
                                    <option key={monthValue} value={monthValue}>
                                        {label}
                                    </option>
                                );
                            })}
                        </select>

                        <div className={styles.mainActions}>
        <span className={styles.counter}>
          {initialLoading && total === 0 ? '—' : `${from}–${to} de ${total}`}
        </span>

                            <button
                                className={styles.iconButton}
                                title="Actualizar"
                                onClick={() => fetchDataAndSummary({})}
                                aria-label="Actualizar lista"
                            >
                                <FiRefreshCw />
                            </button>

                            <button
                                className={styles.primaryButton}
                                onClick={() => setEditModal({ open: true, initial: undefined })}
                            >
                                <FiPlus />
                            </button>
                        </div>
                    </div>
                </div>

                <div className={styles.filterGroup} style={{ gridColumn: '1 / -1' }}>
                    <label className={styles.filterLabel}>Búsqueda General</label>
                    <div className={styles.searchBoxFull}>
                        <FiSearch className={styles.searchIcon} />
                        <input
                            className={styles.searchInput}
                            placeholder="Buscar por lote, piscina, o cantidad de muertos, faltantes, etc."
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Resumen y Totales */}
            <div className={styles.summaryCard}>
                <h2 className={styles.cardTitle}>
                    Resumen del {fechaDesde ? fechaDesde.toLocaleDateString('es-EC', { day: 'numeric', month: 'long', year: 'numeric' }) : '...'}
                    {' '}al{' '}
                    {fechaHasta ? fechaHasta.toLocaleDateString('es-EC', { day: 'numeric', month: 'long', year: 'numeric' }) : '...'}
                </h2>
                <p className={styles.cardSubtitle}>{totals?.total_registros ?? 0} registros encontrados</p>

                {loadingSummary ? (
                    <div className={styles.loadingOverlay}>Cargando resumen...</div>
                ) : (
                    <div className={styles.tableContainer}>
                        <table className={styles.summaryTable}>
                            <thead>
                            <tr>
                                <th>Lote</th>
                                <th>Muertos</th>
                                <th>Faltantes</th>
                                <th>Sobrantes</th>
                                <th>Deformes</th>
                            </tr>
                            </thead>
                            <tbody>
                            {summary.length === 0 ? (
                                <tr><td colSpan={5}>No hay datos para el período seleccionado.</td></tr>
                            ) : (
                                summary.map(s => (
                                    <tr key={s.lote_id}>
                                        <td>{s.lote_nombre}</td>
                                        <td>{s.total_muertos.toLocaleString('es-EC')}</td>
                                        <td>{s.total_faltantes.toLocaleString('es-EC')}</td>
                                        <td>{s.total_sobrantes.toLocaleString('es-EC')}</td>
                                        <td>{s.total_deformes.toLocaleString('es-EC')}</td>
                                    </tr>
                                ))
                            )}
                            </tbody>
                            {totals && summary.length > 0 && (
                                <tfoot>
                                <tr>
                                    <td>Total General</td>
                                    <td>{totals.total_muertos.toLocaleString('es-EC')}</td>
                                    <td>{totals.total_faltantes.toLocaleString('es-EC')}</td>
                                    <td>{totals.total_sobrantes.toLocaleString('es-EC')}</td>
                                    <td>{totals.total_deformes.toLocaleString('es-EC')}</td>
                                </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                )}
            </div>

            {/* Tabla principal */}
            <div className={styles.tableCard}>
                <div className={styles.tableActions}>
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
                    <label className={styles.checkboxLabel}>
                        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                        Mostrar inactivos
                    </label>
                </div>

                {initialLoading ? (
                    <TableSkeleton rows={pageSize} />
                ) : (
                    <>
                        <div className={styles.tableContainer}>
                            <table className={styles.table}>
                                <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Nº de Lote</th>
                                    <th>Piscina</th>
                                    <th>Muertos</th>
                                    <th>Faltantes</th>
                                    <th>Sobrantes</th>
                                    <th>Deformes</th>
                                    <th>Mes</th>
                                    <th>Acciones</th>
                                </tr>
                                </thead>
                                <tbody>
                                {data.length === 0 ? (
                                    <tr><td colSpan={9} className={styles.emptyRow}>Sin registros para los filtros aplicados</td></tr>
                                ) : (
                                    data.map((r) => {
                                        const fechaObj = parseAPIDate(r.fecha);
                                        const fechaDisplay = fechaObj ? fechaObj.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
                                        const mesName = monthNameFromNumber(r.mes) || monthNameFromDate(r.fecha) || '—';
                                        const mesDisplay = mesName ? mesName.charAt(0).toUpperCase() + mesName.slice(1) : '—';

                                        return (
                                            <tr key={r.id} className={loadingList ? styles.rowDim : ''}>
                                                <td className={styles.cell}>{fechaDisplay}</td>
                                                <td className={styles.cell}>{r.lote_nombre ?? '—'}</td>
                                                <td className={styles.cell}>{r.piscina_nombre ?? '—'}</td>
                                                <td className={styles.cellCenter}>{r.muertos}</td>
                                                <td className={styles.cellCenter}>{r.faltantes}</td>
                                                <td className={styles.cellCenter}>{r.sobrantes}</td>
                                                <td className={styles.cellCenter}>{r.deformes}</td>
                                                <td className={styles.cellCenter}>{mesDisplay}</td>
                                                <td className={styles.cellActions}>
                                                    <button className={styles.smallBtn} title="Editar" onClick={() => onAskEdit(r)}>
                                                        <FiEdit2 /><span>Editar</span>
                                                    </button>
                                                    <button className={styles.smallBtnAlt} title={r.active ? 'Inactivar' : 'Restaurar'} onClick={() => onAskToggleActive(r)}>
                                                        <FiTrash2 /><span>{r.active ? 'Inactivar' : 'Restaurar'}</span>
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                                </tbody>
                            </table>
                        </div>

                        <div className={styles.pager}>
                            <button className={styles.pagerBtn} onClick={() => setPage(1)} disabled={!canPrev} aria-label="Primera página">«</button>
                            <button className={styles.pagerBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={!canPrev} aria-label="Anterior">‹</button>
                            <span className={styles.pagerStatus}>Página {page} de {pages}</span>
                            <button className={styles.pagerBtn} onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={!canNext} aria-label="Siguiente">›</button>
                            <button className={styles.pagerBtn} onClick={() => setPage(pages)} disabled={!canNext} aria-label="Última página">»</button>
                        </div>
                    </>
                )}
            </div>

            {/* Modales */}
            {requestModal.open && (
                <RequestModal
                    {...requestModal}
                    onClose={closeRequest}
                    onSubmit={(motivo: string) => submitRequest(requestModal.scope!, requestModal.registro_id!, motivo)}
                    initialSummary={buildSummaryText(data.find(d => d.id === requestModal.registro_id))}
                />
            )}

            {codeModal.open && (
                <CodeModal {...codeModal} onClose={closeCode} onVerified={codeModal.onVerified!} />
            )}

            {editModal.open && (
                <EditModal
                    {...editModal}
                    userRole={userRole}
                    unlockedEditId={unlockedEditId}
                    onClose={onCloseEdit}
                    onRequestOpen={(registro_id, presetMotivo) => {
                        setEditModal({ open: false, initial: undefined });
                        setTimeout(() => openRequest('edicion', registro_id, presetMotivo), 60);
                    }}
                    onAskCodeVerify={(reqId, registro_id) => {
                        setEditModal({ open: false, initial: undefined });
                        openCode({
                            requestId: reqId,
                            registro_id,
                            scope: 'edicion',
                            actionLabel: 'Autorizar edición',
                            onVerified: async () => {
                                setUnlockedEditId(registro_id);
                                Toast.fire({ icon: 'success', title: 'Código verificado. Puedes editar.' });
                                const row = data.find(d => d.id === registro_id);
                                setEditModal({ open: true, initial: row });
                            },
                        });
                    }}
                    onSubmit={async (payload, successMsg) => {
                        try {
                            if (!editModal.initial?.id) {
                                await fetch('/api/losses', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    credentials: 'same-origin',
                                    body: JSON.stringify(payload),
                                }).then(parseResponseOrThrow);
                                Toast.fire({ icon: 'success', title: 'Registro creado' });
                            } else {
                                await submitEdit(editModal.initial.id, payload);
                                Toast.fire({ icon: 'success', title: successMsg ?? 'Registro actualizado' });
                            }
                            setUnlockedEditId(prev => (prev === editModal.initial?.id ? null : prev));
                            setEditModal({ open: false, initial: undefined });
                            await fetchDataAndSummary({});
                        } catch (e: any) {
                            Toast.fire({ icon: 'error', title: e?.message ?? 'Error del servidor' });
                        }
                    }}
                />
            )}
        </div>
    );
}

/* =========================== UI Aux (Skeletons, Modals, PIN) =========================== */

function TableSkeleton({ rows = 10 }: { rows?: number }) {
    return (
        <div className={styles.tableContainer}>
            <table className={styles.table}>
                <thead>
                <tr><th>Fecha</th><th>Nº de Lote</th><th>Piscina</th><th>Muertos</th><th>Faltantes</th><th>Sobrantes</th><th>Deformes</th><th>Mes</th><th>Acciones</th></tr>
                </thead>
                <tbody>
                {Array.from({ length: rows }).map((_, i) => ( <SkeletonRow key={`sk-${i}`} /> ))}
                </tbody>
            </table>
        </div>
    );
}
function SkeletonRow() {
    return <tr><td colSpan={9}><div className={styles.skeletonRow} /></td></tr>;
}

function RequestModal({
                          scope, registro_id, presetMotivo, initialSummary, inactAction, onClose, onSubmit,
                      }: {
    scope: Scope; registro_id?: number; presetMotivo?: string; initialSummary?: string; inactAction?: InactAction;
    onClose: () => void; onSubmit: (motivo: string) => void;
}) {
    const [comentario, setComentario] = useState('');
    const [loading, setLoading] = useState(false);
    const isEdicion = scope === 'edicion';
    const isRestauracion = scope === 'inactivacion' && inactAction === 'RESTAURAR';
    const titulo = isEdicion ? 'Solicitar permiso de edición' : isRestauracion ? 'Solicitar permiso de restauración' : 'Solicitar permiso de inactivación';
    const asunto  = isEdicion ? `Solicitud de edición - Bajas - Registro ${registro_id}` : isRestauracion ? `Solicitud de restauración - Bajas - Registro ${registro_id}` : `Solicitud de inactivación - Bajas - Registro ${registro_id}`;

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <form
                className={styles.modal}
                onClick={(e) => e.stopPropagation()}
                onSubmit={async (e) => {
                    e.preventDefault();
                    setLoading(true);
                    try {
                        const fullMotivo = `${presetMotivo ?? asunto}${comentario ? `\n\nComentario adicional:\n${comentario}` : ''}`;
                        await onSubmit(fullMotivo);
                    } finally { setLoading(false); }
                }}
            >
                <h3 className={styles.modalTitle}>{titulo}</h3>
                <p className={styles.modalSubtitle}>Se enviará una notificación a los administradores para su revisión.</p>
                {isEdicion && (
                    <label className={styles.formLabel}>
                        Resumen del registro
                        <textarea className={styles.textarea} rows={7} readOnly value={initialSummary ?? ''} />
                    </label>
                )}
                <label className={styles.formLabel}>
                    Comentario adicional (opcional)
                    <textarea className={styles.textarea} rows={4} placeholder="Agregar detalles..." value={comentario} onChange={(e) => setComentario(e.target.value)} />
                </label>
                <div className={styles.modalActions}>
                    <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={loading}>Cancelar</button>
                    <button type="submit" className={styles.btnPrimary} disabled={loading}>{loading ? 'Enviando…' : 'Enviar solicitud'}</button>
                </div>
            </form>
        </div>
    );
}

function PinInput({ length = CODE_LENGTH, onComplete }: { length?: number; onComplete: (code: string) => void; }) {
    const [values, setValues] = useState<string[]>(Array(length).fill(''));
    const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
    useEffect(() => { inputsRef.current[0]?.focus(); }, []);

    const handleChange = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.replace(/\D/g, '');
        if (!raw) { setValues(v => { const n=[...v]; n[idx]=''; return n; }); return; }
        const digits = raw.split('');
        setValues(v => {
            const n = [...v];
            for (let i = 0; i < digits.length && idx + i < length; i++) n[idx + i] = digits[i];
            return n;
        });
        const nextIndex = Math.min(idx + digits.length, length - 1);
        inputsRef.current[nextIndex]?.focus();
        setTimeout(() => {
            const assembled = (i => {
                const n = [...values];
                for (let j = 0; j < digits.length && idx + j < length; j++) n[idx + j] = digits[j];
                return n;
            })();
            if (assembled.every(d => d !== '')) onComplete(assembled.join(''));
        }, 0);
    };

    const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace') {
            if (values[idx]) {
                setValues(v => { const n=[...v]; n[idx]=''; return n; });
            } else if (idx > 0) {
                inputsRef.current[idx - 1]?.focus();
                setValues(v => { const n=[...v]; n[idx - 1]=''; return n; });
            }
        }
        if (e.key === 'ArrowLeft' && idx > 0) inputsRef.current[idx - 1]?.focus();
        if (e.key === 'ArrowRight' && idx < length - 1) inputsRef.current[idx + 1]?.focus();
    };

    return (
        <div className={styles.pinRow}>
            {Array.from({ length }).map((_, i) => (
                <input
                    key={i}
                    ref={(el) => (inputsRef.current[i] = el)}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    value={values[i]}
                    onChange={(e) => handleChange(i, e)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    className={styles.pinInput}
                />
            ))}
        </div>
    );
}

function CodeModal({ scope, requestId, registro_id, actionLabel, onClose, onVerified, }: { scope: Scope; requestId: number; registro_id: number; actionLabel: string; onClose: () => void; onVerified: () => Promise<void>; }) {
    const [loading, setLoading] = useState(false);
    const submitCode = async (code: string) => {
        setLoading(true);
        try {
            await fetch(`${ENDPOINTS[scope].base}/${requestId}/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ codigo: code.trim() })
            }).then(parseResponseOrThrow);
            await onVerified();
            onClose();
        } catch (e: any) {
            Toast.fire({ icon: 'error', title: e?.message ?? 'Código inválido o error del servidor' });
        } finally { setLoading(false); }
    };
    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modal} style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
                <div className={styles.modalHeaderIcon}><FiKey /></div>
                <h3 className={styles.modalTitle}>Ingresar código de autorización</h3>
                <p className={styles.modalSubtitle}>Ingresa el código para <b>{actionLabel}</b> del registro #{registro_id}.</p>
                <PinInput onComplete={(code) => !loading && submitCode(code)} />
                <div className={styles.modalActions}>
                    <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={loading}>Cancelar</button>
                </div>
            </div>
        </div>
    );
}


function EditModal({
                       initial,
                       userRole,
                       unlockedEditId,
                       onClose,
                       onRequestOpen,
                       onAskCodeVerify,
                       onSubmit,
                   }: {
    initial?: Loss;
    userRole?: string | null;
    unlockedEditId: number | null;
    onClose: () => void;
    onRequestOpen: (registro_id: number, presetMotivo: string) => void;
    onAskCodeVerify: (requestId: number, registro_id: number) => void;
    onSubmit: (payload: Partial<Loss>, successMsg?: string) => void;
}) {
    const [mounted, setMounted] = useState(false);
    const datePickerRef = useRef<any>(null);
    useEffect(() => {
        setMounted(true);
        if (typeof window !== 'undefined') registerLocale('es', es);
    }, []);

    const isOperator = (userRole ?? '').toUpperCase() === 'OPERADOR';
    const isSuper = (userRole ?? '').toUpperCase() === 'SUPERADMIN';
    const isEditingExisting = Boolean(initial && initial.id);

    const [fecha, setFecha] = useState<Date | null>(initial?.fecha ? new Date(initial.fecha) : null);
    const [lote, setLote] = useState<{ value: number; label: string } | null>(
        initial?.lote_id ? { value: initial.lote_id, label: initial.lote_nombre ?? `Lote ${initial.lote_id}` } : null
    );
    const [piscina, setPiscina] = useState<{ value: number; label: string } | null>(
        initial?.piscina_id ? { value: initial.piscina_id, label: initial.piscina_nombre ?? `Piscina ${initial.piscina_id}` } : null
    );
    const [muertos, setMuertos] = useState<number>(initial?.muertos ?? 0);
    const [faltantes, setFaltantes] = useState<number>(initial?.faltantes ?? 0);
    const [sobrantes, setSobrantes] = useState<number>(initial?.sobrantes ?? 0);
    const [deformes, setDeformes] = useState<number>(initial?.deformes ?? 0);
    const [loading, setLoading] = useState(false);

    const [hasPending, setHasPending] = useState<boolean>(false);
    const [pendingReq, setPendingReq] = useState<{ id: number; hasCode: boolean; estado?: string } | null>(null);

    const [errors, setErrors] = useState<Record<string, string>>({});
    const markError = (name: string, msg?: string) =>
        setErrors((prev) => {
            const next = { ...prev };
            if (msg) next[name] = msg;
            else delete next[name];
            return next;
        });

    const validateCreate = () => {
        const e: Record<string, string> = {};
        if (!fecha) e.fecha = 'La fecha es obligatoria';
        if (!lote) e.lote = 'El lote es obligatorio';
        if (!piscina) e.piscina = 'La piscina es obligatoria';
        setErrors(e);
        return Object.keys(e).length === 0 ? null : e;
    };

    useEffect(() => {
        let ignore = false;
        (async () => {
            if (initial?.id) {
                const pend = await fetchPending(initial.id, 'edicion');
                if (!ignore) {
                    setHasPending(!!pend?.pending);
                    setPendingReq(pend?.request ? { id: pend.request.id, hasCode: !!pend.request.hasCode, estado: pend.request.estado } : null);
                }
            } else {
                setHasPending(false);
                setPendingReq(null);
            }
        })();
        return () => {
            ignore = true;
        };
    }, [initial?.id]);

    useEffect(() => {
        if (!initial) {
            setFecha(null);
            setLote(null);
            setPiscina(null);
            setMuertos(0);
            setFaltantes(0);
            setSobrantes(0);
            setDeformes(0);
            setErrors({});
        } else {
            setFecha(initial.fecha ? new Date(initial.fecha) : null);
            setErrors({});
        }
    }, [initial]);

    const lotesCache = useRef<Map<string, { value: number; label: string }[]>>(new Map());
    const poolsCache = useRef<Map<string, { value: number; label: string }[]>>(new Map());

    const loadLotes = useCallback(async (inputValue: string) => {
        const key = (inputValue ?? '').trim().toLowerCase();
        if (lotesCache.current.has(key)) return lotesCache.current.get(key)!;
        try {
            const q = encodeURIComponent(inputValue ?? '');
            const res = await fetch(`/api/lotes?q=${q}&limit=10`, { cache: 'no-store' });
            const json = await res.json();
            const opts = (json?.data ?? []).map((it: any) => ({ value: it.id, label: it.nombre ?? `Lote ${it.id}` }));
            lotesCache.current.set(key, opts);
            return opts;
        } catch {
            return [];
        }
    }, []);
    const loadPiscinas = useCallback(async (inputValue: string) => {
        const key = (inputValue ?? '').trim().toLowerCase();
        if (poolsCache.current.has(key)) return poolsCache.current.get(key)!;
        try {
            const q = encodeURIComponent(inputValue ?? '');
            const res = await fetch(`/api/pools?q=${q}&limit=10`, { cache: 'no-store' });
            const json = await res.json();
            const opts = (json?.data ?? []).map((it: any) => ({ value: it.id, label: it.nombre ?? `Piscina ${it.id}` }));
            poolsCache.current.set(key, opts);
            return opts;
        } catch {
            return [];
        }
    }, []);

    const handleDateChange = (d: Date | null) => {
        setFecha(d);
        if (!d) markError('fecha', 'La fecha es obligatoria');
        else markError('fecha');
        setTimeout(() => {
            if (datePickerRef.current?.setOpen) datePickerRef.current.setOpen(false);
        }, 0);
    };

    const CustomInputControlled = forwardRef<HTMLInputElement, any>(
        ({ value, onClick, placeholder, ...rest }, ref) => (
            <input
                {...rest}
                ref={ref}
                className={styles.input}
                value={value ?? ''}
                onClick={onClick}
                readOnly
                placeholder={placeholder || 'Seleccionar fecha'}
                aria-label="Seleccionar fecha"
            />
        )
    );
    CustomInputControlled.displayName = 'CustomInputControlled';

    const isUnlocked = unlockedEditId === (initial?.id ?? -1);
    const fieldsDisabled = isOperator && isEditingExisting && !isUnlocked;

    const buildPayload = (): Partial<Loss> => ({
        fecha: fecha ? fecha.toISOString().split('T')[0] : (null as any),
        lote_id: lote ? Number(lote.value) : (null as any),
        piscina_id: piscina ? Number(piscina.value) : (null as any),
        muertos: Number(muertos),
        faltantes: Number(faltantes),
        sobrantes: Number(sobrantes),
        deformes: Number(deformes),
    });

    const submit = async (e?: React.FormEvent) => {
        e?.preventDefault();

        // ✅ Sin SweetAlert: solo marcar errores en línea y no enviar
        if (!isEditingExisting) {
            const errs = validateCreate();
            if (errs) return; // se quedan visibles los mensajes en cada campo
        }

        if (isEditingExisting && !isSuper && !isUnlocked) {
            if (pendingReq?.hasCode) {
                onAskCodeVerify(pendingReq.id, initial!.id);
                return;
            }
            if (hasPending) {
                Toast.fire({ icon: 'info', title: 'Solicitud pendiente sin código. Espera la aprobación.' });
                return;
            }
            onRequestOpen(initial!.id, `Solicitud de edición - Bajas - Registro ${initial!.id}`);
            return;
        }

        setLoading(true);
        try {
            const payload = buildPayload();
            if (!isEditingExisting) onSubmit(payload, 'Registro creado');
            else onSubmit(payload, 'Registro actualizado');
        } finally {
            setLoading(false);
        }
    };

    const title = initial
        ? isOperator
            ? isUnlocked
                ? 'Editar baja'
                : pendingReq?.hasCode
                    ? 'Ver baja (ingresar código)'
                    : hasPending
                        ? 'Ver baja (pendiente de aprobación)'
                        : 'Ver baja (solicitar edición)'
            : 'Editar baja'
        : 'Nueva baja';

    const fechaInvalid = !!errors.fecha;
    const loteInvalid = !!errors.lote;
    const piscinaInvalid = !!errors.piscina;

    return (
        <div className={styles.modalOverlay} role="dialog" aria-modal>
            <form className={`${styles.modal} ${styles.modalWide || ''}`} onSubmit={submit}>
                <h3 className={styles.modalTitle}>{title}</h3>

                <div className={styles.modalGrid || ''} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                        <label className={styles.formLabel}>
                            Fecha
                            {mounted ? (
                                <DatePicker
                                    ref={datePickerRef}
                                    selected={fecha}
                                    onChange={handleDateChange}
                                    dateFormat="yyyy-MM-dd"
                                    placeholderText="Seleccionar fecha"
                                    customInput={<CustomInputControlled aria-invalid={fechaInvalid || undefined} />}
                                    maxDate={new Date()}
                                    isClearable
                                    showPopperArrow={false}
                                    popperPlacement="bottom-start"
                                    shouldCloseOnSelect
                                    locale="es"
                                    disabled={fieldsDisabled}
                                />
                            ) : (
                                <input className={styles.input} placeholder="Seleccionar fecha" readOnly />
                            )}
                            <div className={styles.datePreview} aria-hidden style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 13 }}>
                                {fecha
                                    ? fecha.toLocaleDateString('es-EC', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
                                    : '—'}
                            </div>
                            {fechaInvalid && <div className={styles.errorText}>{errors.fecha}</div>}
                        </label>

                        <label className={styles.formLabel}>
                            Lote (buscar)
                            <AsyncSelect
                                cacheOptions
                                defaultOptions
                                loadOptions={loadLotes}
                                value={lote}
                                onChange={(v: any) => {
                                    setLote(v);
                                    if (!v) markError('lote', 'El lote es obligatorio');
                                    else markError('lote');
                                }}
                                onBlur={() => {
                                    if (!lote) markError('lote', 'El lote es obligatorio');
                                }}
                                placeholder="Buscar lote por nombre o ID..."
                                isClearable
                                isDisabled={fieldsDisabled}
                                className={loteInvalid ? styles.selectError : undefined}
                                classNamePrefix="rs"
                            />
                            {loteInvalid && <div className={styles.errorText}>{errors.lote}</div>}
                        </label>

                        <label className={styles.formLabel}>
                            Piscina (buscar)
                            <AsyncSelect
                                cacheOptions
                                defaultOptions
                                loadOptions={loadPiscinas}
                                value={piscina}
                                onChange={(v: any) => {
                                    setPiscina(v);
                                    if (!v) markError('piscina', 'La piscina es obligatoria');
                                    else markError('piscina');
                                }}
                                onBlur={() => {
                                    if (!piscina) markError('piscina', 'La piscina es obligatoria');
                                }}
                                placeholder="Buscar piscina por nombre o ID..."
                                isClearable
                                isDisabled={fieldsDisabled}
                                className={piscinaInvalid ? styles.selectError : undefined}
                                classNamePrefix="rs"
                            />
                            {piscinaInvalid && <div className={styles.errorText}>{errors.piscina}</div>}
                        </label>
                    </div>

                    <div>
                        <label className={styles.formLabel}>
                            Muertos
                            <input className={styles.input} type="number" min={0} value={muertos} onChange={(e) => setMuertos(Number(e.target.value))} disabled={fieldsDisabled} />
                        </label>

                        <label className={styles.formLabel}>
                            Faltantes
                            <input className={styles.input} type="number" min={0} value={faltantes} onChange={(e) => setFaltantes(Number(e.target.value))} disabled={fieldsDisabled} />
                        </label>

                        <label className={styles.formLabel}>
                            Sobrantes
                            <input className={styles.input} type="number" min={0} value={sobrantes} onChange={(e) => setSobrantes(Number(e.target.value))} disabled={fieldsDisabled} />
                        </label>

                        <label className={styles.formLabel}>
                            Deformes
                            <input className={styles.input} type="number" min={0} value={deformes} onChange={(e) => setDeformes(Number(e.target.value))} disabled={fieldsDisabled} />
                        </label>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                        {isEditingExisting ? `Registro ID: ${initial?.id}` : 'Nuevo registro'}
                    </div>

                    <div style={{ display: 'flex', gap: 10 }}>
                        <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={loading}>
                            Cancelar
                        </button>

                        {(!isEditingExisting || !isOperator || (isOperator && unlockedEditId === initial?.id)) ? (
                            <button type="submit" className={styles.btnPrimary} disabled={loading}>
                                {loading ? 'Guardando…' : isEditingExisting ? 'Guardar cambios' : 'Crear'}
                            </button>
                        ) : (
                            <>
                                {pendingReq?.hasCode ? (
                                    <button
                                        type="button"
                                        className={styles.btnPrimary}
                                        onClick={() => onAskCodeVerify(pendingReq.id, initial!.id)}
                                        disabled={loading}
                                    >
                                        <FiKey style={{ marginRight: 6 }} /> Ingresar código
                                    </button>
                                ) : hasPending ? (
                                    <button type="button" className={styles.btnSecondary} disabled>
                                        Solicitud pendiente…
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        className={styles.btnPrimary}
                                        onClick={() => onRequestOpen(initial!.id, `Solicitud de edición - Bajas - Registro ${initial!.id}`)}
                                    >
                                        Solicitar edición
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </form>
        </div>
    );
}
