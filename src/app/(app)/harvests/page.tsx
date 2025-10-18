// src/app/harvests/page.tsx
'use client';

import React, { useCallback, useEffect, useRef, useState, forwardRef } from 'react';
import dynamic from 'next/dynamic';
import AsyncSelect from 'react-select/async';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import { FiRefreshCw, FiPlus, FiSearch, FiEdit2, FiTrash2, FiKey, FiCalendar } from 'react-icons/fi';
import styles from './harvests.module.css';

const DatePicker = dynamic(() => import('react-datepicker'), { ssr: false });
if (typeof window !== 'undefined') {
    require('react-datepicker/dist/react-datepicker.css');
}
import { registerLocale } from 'react-datepicker';
import es from 'date-fns/locale/es';

/* ========= Constants & Types ========= */
const ENDPOINTS = {
    edit: { base: '/api/edit-requests' },
    inactivation: { base: '/api/inactivation-requests' },
} as const;

const CODE_LENGTH = 4 as const;

type Harvest = {
    id: number;
    year?: number;
    day_word?: string | null;
    date: string; // YYYY-MM-DD
    lot_id?: number;
    lot_name?: string | null;
    pond_id?: number;
    pond_name?: string | null;
    trout_count: number;
    sheet_number?: string | null;
    detail_id?: number | null;
    detail_name?: string | null;
    package_count_id?: number | null;
    package_count_label?: string | null;
    kilos_text?: any | null; // ahora puede ser number o string; lo normalizamos al mostrar
    active?: boolean;
};

type PendingInfo = {
    pending: boolean;
    request?: { id: number; hasCode: boolean; status?: string; expiresAt?: string | null; };
} | null;

type Scope = 'edit' | 'inactivation';
type InactAction = 'INACTIVATE' | 'RESTORE';

type SummaryRow = {
    key: string; // lotId|detailId
    lot_id?: number | null;
    lot_label: string;
    detail_id?: number | null;
    detail_label?: string | null;
    total_trout: number;
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

function parseAPIDate(dateStr?: string): Date | null {
    if (!dateStr) return null;
    const base = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T12:00:00Z` : dateStr;
    const d = new Date(base);
    return Number.isNaN(d.getTime()) ? null : d;
}
function weekdayNameFromDate(date?: Date | null) {
    if (!date) return null;
    return date.toLocaleDateString('es-EC', { weekday: 'long' });
}

const isRejected = (p?: PendingInfo) =>
    (p?.request?.status ?? p?.request?.estado ?? '').toString().trim().toUpperCase() === 'RECHAZADO';

async function fetchPending(record_id: number, scope: Scope): Promise<PendingInfo> {
    try {
        const base = ENDPOINTS[scope].base;
        const res = await fetch(`${base}/pending?tabla=cosechas&registro_id=${record_id}`, {
            cache: 'no-store',
            credentials: 'same-origin',
        });
        const j: any = await res.json().catch(() => null);
        if (!j?.success) return { pending: !!j?.pending, request: undefined };

        const statusNorm = (j?.request?.status ?? j?.request?.estado ?? '').toString().trim().toUpperCase();
        const hasCode = j?.request?.hasCode ?? (statusNorm === 'APROBADO' || statusNorm === 'APPROVED');

        return {
            pending: !!j.pending,
            request: j.request
                ? {
                    id: j.request.id,
                    hasCode,
                    status: statusNorm,
                    expiresAt: j.request.expiresAt ?? j.request.codigo_expira_en ?? null
                }
                : undefined,
        };
    } catch {
        return null;
    }
}

/* formatter simple */
function fmtNumber(n: any) {
    const num = Number(n);
    if (!isFinite(num)) return '—';
    return num.toLocaleString('es-EC');
}

/* formatKilos: muestra hasta 3 decimales, elimina ceros finales y agrega "kg" */
function formatKilos(raw: any) {
    if (raw == null || raw === '') return '—';
    // si viene como "23.5 alad kg" o "23,5 kg", extraer número
    let n: number;
    if (typeof raw === 'number') n = raw;
    else {
        const s = String(raw).trim().replace(/[^0-9\-,.]/g, '').replace(',', '.');
        n = Number(s);
    }
    if (!isFinite(n)) return '—';
    let s = n.toLocaleString('es-EC', { maximumFractionDigits: 3 });
    s = s.replace(/([,\.]\d*?[1-9])0+$/, '$1'); // quita ceros finales si hay decimales
    s = s.replace(/[,.]0+$/, ''); // si solo .0 -> quita
    return `${s} kg`;
}

/* Utility: aggregate records by lot+detail into SummaryRow[] */
function aggregateByLotDetail(records: (Partial<Harvest> & { trout_count?: number })[]): SummaryRow[] {
    const map = new Map<string, SummaryRow>();
    for (const r of records) {
        const lotId = r.lot_id ?? null;
        const detailId = r.detail_id ?? null;
        const key = `${lotId ?? 'null'}|${detailId ?? 'null'}`;
        const lotLabel = r.lot_name ?? (lotId ? `Lote ${lotId}` : '—');
        const detailLabel = r.detail_name ?? undefined;
        const add = Number(r.trout_count ?? 0);
        const existing = map.get(key);
        if (existing) {
            existing.total_trout += add;
        } else {
            map.set(key, {
                key,
                lot_id: lotId,
                lot_label: lotLabel,
                detail_id: detailId ?? undefined,
                detail_label: detailLabel,
                total_trout: add,
            });
        }
    }
    // convert to array and sort by lot_label (optional)
    return Array.from(map.values()).sort((a, b) => {
        if (a.lot_label < b.lot_label) return -1;
        if (a.lot_label > b.lot_label) return 1;
        if ((a.detail_label ?? '') < (b.detail_label ?? '')) return -1;
        if ((a.detail_label ?? '') > (b.detail_label ?? '')) return 1;
        return 0;
    });
}

/* =========================== Page =========================== */
export default function HarvestsPage() {
    const [data, setData] = useState<Harvest[]>([]);
    const [initialLoading, setInitialLoading] = useState(true);
    const [loadingList, setLoadingList] = useState(false);

    const [dateFrom, setDateFrom] = useState<Date | null>(null);
    const [dateTo, setDateTo] = useState<Date | null>(null);
    const [selectedMonth, setSelectedMonth] = useState<string>('');

    const [q, setQ] = useState('');
    const [debouncedQ, setDebouncedQ] = useState('');
    const [showInactive, setShowInactive] = useState(false);

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [pages, setPages] = useState(1);

    const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([]);
    const [loadingSummary, setLoadingSummary] = useState(true);

    const [userRole, setUserRole] = useState<string | null>(null);
    const [unlockedEditId, setUnlockedEditId] = useState<number | null>(null);

    const [requestModal, setRequestModal] = useState<{ open: boolean; record_id?: number; presetReason?: string; scope?: Scope; inactAction?: InactAction }>({ open: false });
    const [codeModal, setCodeModal] = useState<{ open: boolean; requestId?: number; record_id?: number; actionLabel?: string; scope?: Scope; onVerified?: () => Promise<void> }>({ open: false });
    const [editModal, setEditModal] = useState<{ open: boolean; initial?: Harvest }>({ open: false });

    const abortRef = useRef<AbortController | null>(null);

    const formatDateParam = (date: Date | null) =>
        date ? new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString().split('T')[0] : '';

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
        return () => clearTimeout(t);
    }, [q]);

    useEffect(() => { setPage(1); }, [debouncedQ, showInactive, dateFrom, dateTo]);

    useEffect(() => {
        registerLocale('es', es);
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        setDateFrom(start);
        setDateTo(end);
        setSelectedMonth(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
        void fetchUser();
        // eslint-disable-next-line
    }, []);

    useEffect(() => {
        if (dateFrom && dateTo) {
            void fetchDataAndSummary({ initial: initialLoading });
        }
        // eslint-disable-next-line
    }, [page, pageSize, debouncedQ, showInactive, dateFrom, dateTo]);

    const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const monthValue = e.target.value;
        setSelectedMonth(monthValue);
        if (monthValue) {
            const [year, month] = monthValue.split('-').map(Number);
            const startDate = new Date(year, month - 1, 1);
            const endDate = new Date(year, month, 0);
            setDateFrom(startDate);
            setDateTo(endDate);
        } else {
            setDateFrom(null);
            setDateTo(null);
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

    /** Fetch both the paged records and a summary. Summary may be pre-aggregated from backend
     * or raw records — we normalize to aggregate by lot+detail here.
     */
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
            desde: formatDateParam(dateFrom),
            hasta: formatDateParam(dateTo),
        });
        if (debouncedQ) params.set('q', debouncedQ);

        try {
            const [dataRes, summaryRes] = await Promise.allSettled([
                fetch(`/api/harvests?${params.toString()}`, { cache: 'no-store', signal: ac.signal }),
                fetch(`/api/harvests/summary?desde=${formatDateParam(dateFrom)}&hasta=${formatDateParam(dateTo)}`, { cache: 'no-store', signal: ac.signal }),
            ]);

            // handle data (paged)
            if (dataRes.status === 'fulfilled') {
                const dataJson = await (dataRes.value).json().catch(() => null);
                if (dataJson?.success) {
                    setData(dataJson.data ?? []);
                    setTotal(Number(dataJson.total ?? 0));
                    setPages(Math.max(1, Number(dataJson.pages ?? 1)));
                } else {
                    setData([]); setTotal(0); setPages(1);
                    Toast.fire({ icon: 'error', title: dataJson?.msg ?? 'Error al cargar registros' });
                }
            } else {
                // fetch failed
                setData([]); setTotal(0); setPages(1);
                Toast.fire({ icon: 'error', title: 'Error al cargar registros' });
            }

            // handle summary: try to parse backend summary; if absent or not aggregated, aggregate client-side
            let summaryRows: SummaryRow[] = [];
            if (summaryRes.status === 'fulfilled') {
                const summJson = await (summaryRes.value).json().catch(() => null);
                if (summJson?.success && Array.isArray(summJson.summary) && summJson.summary.length > 0) {
                    // try to detect if backend summary is aggregated (has total_trout or total_cantidad, etc.)
                    const first = summJson.summary[0];
                    if ('total_trout' in first || 'total_cantidad' in first || 'total' in first || ('trout_count' in first && typeof first.trout_count === 'number' && 'lot_id' in first)) {
                        // normalize backend-provided aggregated rows (support several shapes)
                        summaryRows = (summJson.summary as any[]).map((r: any) => {
                            const lot_id = r.lot_id ?? r.lote_id ?? null;
                            const lot_label = r.lot_name ?? r.lote_nombre ?? r.lot ?? (lot_id ? `Lote ${lot_id}` : '—');
                            const detail_id = r.detail_id ?? r.detalle_id ?? null;
                            const detail_label = r.detail_name ?? r.detalle_nombre ?? r.detail ?? undefined;
                            const total_trout = Number(r.total_trout ?? r.total_cantidad ?? r.total ?? r.trout_count ?? 0);
                            const key = `${lot_id ?? 'null'}|${detail_id ?? 'null'}`;
                            return {
                                key,
                                lot_id,
                                lot_label,
                                detail_id: detail_id ?? undefined,
                                detail_label: detail_label ?? undefined,
                                total_trout,
                            } as SummaryRow;
                        });
                    } else {
                        // assume it's a list of individual records -> aggregate
                        summaryRows = aggregateByLotDetail(summJson.summary.map((s: any) => ({
                            lot_id: s.lot_id ?? s.lote_id ?? null,
                            lot_name: s.lot_name ?? s.lote_nombre ?? undefined,
                            detail_id: s.detail_id ?? s.detalle_id ?? null,
                            detail_name: s.detail_name ?? s.detalle_nombre ?? undefined,
                            trout_count: Number(s.trout_count ?? s.cantidad ?? 0),
                        })));
                    }
                } else {
                    // backend summary empty -> fallback to aggregating from paged data (or empty)
                    let pageDataArr: any[] = [];
                    try {
                        if (dataRes.status === 'fulfilled') {
                            const dataJson = await (dataRes.value).json().catch(() => null);
                            pageDataArr = Array.isArray(dataJson?.data) ? dataJson.data : [];
                        }
                    } catch {}
                    if (pageDataArr.length > 0) {
                        summaryRows = aggregateByLotDetail(pageDataArr.map((r: any) => ({
                            lot_id: r.lot_id ?? r.lote_id ?? null,
                            lot_name: r.lot_name ?? r.lote_nombre ?? undefined,
                            detail_id: r.detail_id ?? r.detalle_id ?? null,
                            detail_name: r.detail_name ?? r.detalle_nombre ?? undefined,
                            trout_count: Number(r.trout_count ?? r.cantidad ?? 0),
                        })));
                    } else {
                        summaryRows = aggregateByLotDetail(data.map(d => ({
                            lot_id: d.lot_id ?? d.lote_id ?? null,
                            lot_name: d.lot_name ?? d.lote_nombre ?? undefined,
                            detail_id: d.detail_id ?? d.detalle_id ?? null,
                            detail_name: d.detail_name ?? d.detalle_nombre ?? undefined,
                            trout_count: Number(d.trout_count ?? d.cantidad ?? 0),
                        })));
                    }
                }
            } else {
                // summary fetch failed -> fallback to aggregating from page data
                summaryRows = aggregateByLotDetail(data.map(d => ({
                    lot_id: d.lot_id ?? d.lote_id ?? null,
                    lot_name: d.lot_name ?? d.lote_nombre ?? undefined,
                    detail_id: d.detail_id ?? d.detalle_id ?? null,
                    detail_name: d.detail_name ?? d.detalle_nombre ?? undefined,
                    trout_count: Number(d.trout_count ?? d.cantidad ?? 0),
                })));
            }

            setSummaryRows(summaryRows);
        } catch (e: any) {
            if (e?.name !== 'AbortError') {
                console.error(e);
                setData([]); setTotal(0); setPages(1);
                setSummaryRows([]);
                Toast.fire({ icon: 'error', title: 'Error cargando cosechas' });
            }
        } finally {
            setInitialLoading(false);
            setLoadingList(false);
            setLoadingSummary(false);
            abortRef.current = null;
        }
    }

    const openRequest = (scope: Scope, record_id?: number, presetReason?: string, inactAction?: InactAction) =>
        setRequestModal({ open: true, record_id, presetReason, scope, inactAction });
    const closeRequest = () => setRequestModal({ open: false, record_id: undefined, presetReason: undefined, scope: undefined, inactAction: undefined });
    const openCode = (opts: { requestId: number; record_id: number; actionLabel: string; scope: Scope; onVerified: () => Promise<void> }) =>
        setCodeModal({ open: true, ...opts });
    const closeCode = () => setCodeModal({ open: false, requestId: undefined, record_id: undefined, actionLabel: undefined, onVerified: undefined, scope: undefined });
    const onCloseEdit = () => setEditModal({ open: false, initial: undefined });

    // ===== Edit flow (keeps previous behavior) =====
    const onAskEdit = async (row?: Harvest) => {
        const isSuper = (userRole ?? '').toUpperCase() === 'SUPERADMIN';
        const isOperator = (userRole ?? '').toUpperCase() === 'OPERADOR' || (userRole ?? '').toUpperCase() === 'OPERATOR';

        if (!row?.id) { setEditModal({ open: true, initial: undefined }); return; }
        if (isSuper) { setEditModal({ open: true, initial: row }); return; }

        if (isOperator) {
            const pend = await fetchPending(row.id, 'edit');

            if (isRejected(pend)) {
                await Swal.fire({
                    icon: 'error',
                    title: 'Solicitud Rechazada',
                    text: 'Tu solicitud anterior para editar este registro fue rechazada por un administrador.',
                    confirmButtonText: 'Entendido, crear nueva solicitud',
                });
                const reason = `Nueva solicitud de edición - cosechas - Registro ${row.id}`;
                openRequest('edit', row.id, reason);
                return;
            }

            if (pend?.pending) {
                if (pend.request?.hasCode) {
                    openCode({
                        requestId: pend.request.id,
                        record_id: row.id,
                        actionLabel: 'Autorizar edición',
                        scope: 'edit',
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
            const reason = `Solicitud de edición - cosechas - Registro ${row.id}`;
            openRequest('edit', row.id, reason);
            return;
        }

        Toast.fire({ icon: 'error', title: 'No tienes permisos para editar.' });
    };

    // ===== Inactivate / Restore flow (keeps previous behavior) =====
    const onAskToggleActive = async (row: Harvest) => {
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
                    await fetch(`/api/harvests/${row.id}`, { method: 'DELETE', credentials: 'same-origin' }).then(parseResponseOrThrow);
                    Toast.fire({ icon: 'success', title: `Registro ${row.id} inactivado` });
                } else {
                    await fetch(`/api/harvests/${row.id}`, {
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

        const pend = await fetchPending(row.id, 'inactivation');
        const isRestore: InactAction = row.active ? 'INACTIVATE' : 'RESTORE';

        if (isRejected(pend)) {
            await Swal.fire({
                icon: 'error',
                title: 'Solicitud Rechazada',
                text: `Tu solicitud anterior para ${isRestore.toLowerCase()} este registro fue rechazada por un administrador.`,
                confirmButtonText: 'Entendido, crear nueva solicitud',
            });
            const reason = `Nueva solicitud para ${isRestore} registro ${row.id} (cosechas).`;
            openRequest('inactivation', row.id, reason, isRestore);
            return;
        }

        if (pend?.pending) {
            if (pend.request?.hasCode) {
                openCode({
                    requestId: pend.request.id,
                    record_id: row.id,
                    actionLabel: row.active ? 'Inactivar' : 'Restaurar',
                    scope: 'inactivation',
                    onVerified: async () => {
                        try {
                            if (row.active) {
                                await fetch(`/api/harvests/${row.id}`, { method: 'DELETE', credentials: 'same-origin' }).then(parseResponseOrThrow);
                                Toast.fire({ icon: 'success', title: `Registro ${row.id} inactivado` });
                            } else {
                                await fetch(`/api/harvests/${row.id}`, {
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
            const reason = `Solicitud para ${row.active ? 'INACTIVAR' : 'RESTAURAR'} registro ${row.id} (cosechas). Favor autorizar.`;
            openRequest('inactivation', row.id, reason, isRestore);
        }
    };

    async function submitRequest(scope: Scope, record_id: number, reason: string) {
        try {
            const base = ENDPOINTS[scope].base;
            await fetch(base, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ tabla: 'cosechas', registro_id: record_id, motivo: reason }),
            }).then(parseResponseOrThrow);
            Toast.fire({ icon: 'success', title: `Solicitud enviada` });
            closeRequest();
        } catch (e: any) {
            Toast.fire({ icon: 'error', title: e?.message ?? 'Error enviando solicitud' });
        }
    }

    async function submitEdit(id: number, updates: Partial<Harvest>) {
        await fetch(`/api/harvests/${id}`, {
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
            <div className={styles.filtersCard}>
                <div className={styles.filterGroup}>
                    <label className={styles.filterLabel}>Rango de Fechas</label>

                    <div className={styles.dateRangePicker}>
                        <DatePicker
                            selected={dateFrom}
                            onChange={(date: Date) => { setDateFrom(date); setSelectedMonth(''); }}
                            selectsStart
                            startDate={dateFrom}
                            endDate={dateTo}
                            dateFormat="dd/MM/yyyy"
                            locale="es"
                            customInput={<CustomDateInput placeholder="Desde" />}
                        />
                        <span className={styles.dateSeparator}>hasta</span>
                        <DatePicker
                            selected={dateTo}
                            onChange={(date: Date) => { setDateTo(date); setSelectedMonth(''); }}
                            selectsEnd
                            startDate={dateFrom}
                            endDate={dateTo}
                            minDate={dateFrom ?? undefined}
                            dateFormat="dd/MM/yyyy"
                            locale="es"
                            customInput={<CustomDateInput placeholder="Hasta" />}
                        />
                    </div>
                </div>

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
                            placeholder="Buscar por lote, piscina, detalle, hoja..."
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Summary (aggregated by lot + detail) */}
            <div className={styles.summaryCard}>
                <h2 className={styles.cardTitle}>
                    Resumen (por lote y detalle)
                </h2>
                <p className={styles.cardSubtitle}>{summaryRows.length} filas</p>

                {loadingSummary ? (
                    <div className={styles.loadingOverlay}>Cargando resumen...</div>
                ) : (
                    <div className={styles.tableContainer}>
                        <table className={styles.summaryTable}>
                            <thead>
                            <tr>
                                <th>Lote</th>
                                <th>Detalle</th>
                                <th style={{ textAlign: 'center' }}>Total truchas</th>
                            </tr>
                            </thead>
                            <tbody>
                            {summaryRows.length === 0 ? (
                                <tr><td colSpan={3}>No hay datos para el período seleccionado.</td></tr>
                            ) : (
                                summaryRows.map(s => (
                                    <tr key={s.key}>
                                        <td>{s.lot_label ?? '—'}</td>
                                        <td>{s.detail_label ?? '—'}</td>
                                        <td style={{ textAlign: 'center' }}>{fmtNumber(s.total_trout)}</td>
                                    </tr>
                                ))
                            )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Main table */}
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
                                    <th>Día</th>
                                    <th>Año</th>
                                    <th>Lote</th>
                                    <th>Piscina</th>
                                    <th>Nº truchas</th>
                                    <th>Nº hoja</th>
                                    <th>Detalle</th>
                                    <th>Paquetes</th>
                                    <th>Kilos kg</th>
                                    <th>Acciones</th>
                                </tr>
                                </thead>
                                <tbody>
                                {data.length === 0 ? (
                                    <tr><td colSpan={11} className={styles.emptyRow}>Sin registros para los filtros aplicados</td></tr>
                                ) : (
                                    data.map((r) => {
                                        const dateObj = parseAPIDate(r.date);
                                        const dateDisplay = dateObj ? dateObj.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
                                        const dayWord = dateObj ? weekdayNameFromDate(dateObj) : '—';
                                        const year = dateObj ? dateObj.getFullYear() : '—';

                                        return (
                                            <tr key={r.id} className={loadingList ? styles.rowDim : ''}>
                                                <td className={styles.cell}>{dateDisplay}</td>
                                                <td className={styles.cell}>{dayWord}</td>
                                                <td className={styles.cellCenter}>{year}</td>
                                                <td className={styles.cell}>{r.lot_name ?? '—'}</td>
                                                <td className={styles.cell}>{r.pond_name ?? '—'}</td>
                                                <td className={styles.cellCenter}>{fmtNumber(r.trout_count)}</td>
                                                <td className={styles.cell}>{r.sheet_number ?? '—'}</td>
                                                <td className={styles.cell}>{r.detail_name ?? '—'}</td>
                                                <td className={styles.cellCenter}>{r.package_count_label ?? '—'}</td>
                                                <td className={styles.cellCenter}>{formatKilos(r.kilos_text)}</td>
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

            {/* Modals */}
            {requestModal.open && (
                <RequestModal
                    {...requestModal}
                    onClose={closeRequest}
                    onSubmit={(reason: string) => submitRequest(requestModal.scope!, requestModal.record_id!, reason)}
                    initialSummary={buildRecordSummary(data.find(d => d.id === requestModal.record_id))}
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
                    onRequestOpen={(record_id, presetReason) => {
                        setEditModal({ open: false, initial: undefined });
                        setTimeout(() => openRequest('edit', record_id, presetReason), 60);
                    }}
                    onAskCodeVerify={(reqId, record_id) => {
                        setEditModal({ open: false, initial: undefined });
                        openCode({
                            requestId: reqId,
                            record_id,
                            scope: 'edit',
                            actionLabel: 'Autorizar edición',
                            onVerified: async () => {
                                setUnlockedEditId(record_id);
                                Toast.fire({ icon: 'success', title: 'Código verificado. Puedes editar.' });
                                const row = data.find(d => d.id === record_id);
                                setEditModal({ open: true, initial: row });
                            },
                        });
                    }}
                    onSubmit={async (payload, successMsg) => {
                        try {
                            if (!editModal.initial?.id) {
                                await fetch('/api/harvests', {
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

function buildRecordSummary(item?: Harvest | null) {
    if (!item) return '';
    const lines: string[] = [];
    lines.push(`ID: ${item.id}`);
    lines.push(`Fecha: ${item.date ?? '—'}`);
    lines.push(`Día: ${item.day_word ?? '—'}`);
    lines.push(`Año: ${item.year ?? '—'}`);
    lines.push(`Lote: ${item.lot_name ?? '—'}`);
    lines.push(`Piscina: ${item.pond_name ?? '—'}`);
    lines.push(`Nº truchas: ${item.trout_count ?? 0}`);
    lines.push(`Nro hoja: ${item.sheet_number ?? '—'}`);
    lines.push(`Detalle: ${item.detail_name ?? '—'}`);
    lines.push(`Paquetes: ${item.package_count_label ?? '—'}`);
    lines.push(`Kilos kg: ${formatKilos(item.kilos_text)}`);
    return lines.join('\n');
}

function TableSkeleton({ rows = 10 }: { rows?: number }) {
    return (
        <div className={styles.tableContainer}>
            <table className={styles.table}>
                <thead>
                <tr>
                    <th>Fecha</th><th>Día</th><th>Año</th><th>Lote</th><th>Piscina</th><th>Nº truchas</th><th>Nº hoja</th><th>Detalle</th><th>Paquetes</th><th>Kilos kg</th><th>Acciones</th>
                </tr>
                </thead>
                <tbody>
                {Array.from({ length: rows }).map((_, i) => ( <SkeletonRow key={`sk-${i}`} /> ))}
                </tbody>
            </table>
        </div>
    );
}
function SkeletonRow() {
    return <tr><td colSpan={11}><div className={styles.skeletonRow} /></td></tr>;
}

/* --------- RequestModal, PinInput, CodeModal, EditModal (adapted) --------- */

function RequestModal({
                          scope, record_id, presetReason, initialSummary, inactAction, onClose, onSubmit,
                      }: {
    scope: Scope; record_id?: number; presetReason?: string; initialSummary?: string; inactAction?: InactAction;
    onClose: () => void; onSubmit: (reason: string) => void;
}) {
    const [comment, setComment] = useState('');
    const [loading, setLoading] = useState(false);
    const isEdit = scope === 'edit';
    const isRestore = scope === 'inactivation' && inactAction === 'RESTORE';
    const title = isEdit ? 'Solicitar permiso de edición' : isRestore ? 'Solicitar permiso de restauración' : 'Solicitar permiso de inactivación';
    const subject  = isEdit ? `Solicitud de edición - cosechas - Registro ${record_id}` : isRestore ? `Solicitud de restauración - cosechas - Registro ${record_id}` : `Solicitud de inactivación - cosechas - Registro ${record_id}`;

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <form
                className={styles.modal}
                onClick={(e) => e.stopPropagation()}
                onSubmit={async (e) => {
                    e.preventDefault();
                    setLoading(true);
                    try {
                        const fullReason = `${presetReason ?? subject}${comment ? `\n\nComentario adicional:\n${comment}` : ''}`;
                        await onSubmit(fullReason);
                    } finally { setLoading(false); }
                }}
            >
                <h3 className={styles.modalTitle}>{title}</h3>
                <p className={styles.modalSubtitle}>Se enviará una notificación a los administradores para su revisión.</p>
                {isEdit && (
                    <label className={styles.formLabel}>
                        Resumen del registro
                        <textarea className={styles.textarea} rows={7} readOnly value={initialSummary ?? ''} />
                    </label>
                )}
                <label className={styles.formLabel}>
                    Comentario adicional (opcional)
                    <textarea className={styles.textarea} rows={4} placeholder="Agregar detalles..." value={comment} onChange={(e) => setComment(e.target.value)} />
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

function CodeModal({ scope, requestId, record_id, actionLabel, onClose, onVerified, }: { scope: Scope; requestId: number; record_id: number; actionLabel: string; onClose: () => void; onVerified: () => Promise<void>; }) {
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
                <p className={styles.modalSubtitle}>Ingresa el código para <b>{actionLabel}</b> del registro #{record_id}.</p>
                <PinInput onComplete={(code) => !loading && submitCode(code)} />
                <div className={styles.modalActions}>
                    <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={loading}>Cancelar</button>
                </div>
            </div>
        </div>
    );
}

/* ---------- EditModal (form) - adapted to the harvest fields and using catalog endpoints ---------- */
function EditModal({
                       initial,
                       userRole,
                       unlockedEditId,
                       onClose,
                       onRequestOpen,
                       onAskCodeVerify,
                       onSubmit,
                   }: {
    initial?: Harvest;
    userRole?: string | null;
    unlockedEditId: number | null;
    onClose: () => void;
    onRequestOpen: (record_id: number, presetReason: string) => void;
    onAskCodeVerify: (requestId: number, record_id: number) => void;
    onSubmit: (payload: Partial<Harvest>, successMsg?: string) => void;
}) {
    const [mounted, setMounted] = useState(false);
    const datePickerRef = useRef<any>(null);
    useEffect(() => {
        setMounted(true);
        if (typeof window !== 'undefined') registerLocale('es', es);
    }, []);

    const isOperator = (userRole ?? '').toUpperCase() === 'OPERADOR' || (userRole ?? '').toUpperCase() === 'OPERATOR';
    const isSuper = (userRole ?? '').toUpperCase() === 'SUPERADMIN';
    const isEditingExisting = Boolean(initial && initial.id);

    const [date, setDate] = useState<Date | null>(initial?.date ? parseAPIDate(initial.date) : null);
    const [lot, setLot] = useState<{ value: number; label: string } | null>(initial?.lot_id ? { value: initial.lot_id, label: initial.lot_name ?? `Lote ${initial.lot_id}` } : null);
    const [pond, setPond] = useState<{ value: number; label: string } | null>(initial?.pond_id ? { value: initial.pond_id, label: initial.pond_name ?? `Piscina ${initial.pond_id}` } : null);
    const [troutCount, setTroutCount] = useState<number>(initial?.trout_count ?? 0);
    const [sheetNumber, setSheetNumber] = useState<string>(initial?.sheet_number ?? '');
    const [detail, setDetail] = useState<{ value: number; label: string } | null>(initial?.detail_id ? { value: initial.detail_id, label: initial.detail_name ?? `Detalle ${initial.detail_id}` } : null);
    const [packageCount, setPackageCount] = useState<{ value: number; label: string } | null>(initial?.package_count_id ? { value: initial.package_count_id, label: initial.package_count_label ?? `${initial.package_count_label}` } : null);

    // --- Kilos: ahora numérico con hasta 3 decimales ---
    function parseKilosValue(v: any): number | null {
        if (v == null || v === '') return null;
        if (typeof v === 'number') return v;
        const s = String(v).trim().replace(/[^0-9\-,.]/g, '').replace(',', '.');
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    }
    const [kilos, setKilos] = useState<number | null>(parseKilosValue(initial?.kilos_text) ?? null);

    const [loading, setLoading] = useState(false);

    const [hasPending, setHasPending] = useState<boolean>(false);
    const [pendingReq, setPendingReq] = useState<{ id: number; hasCode: boolean; status?: string } | null>(null);

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
        if (!date) e.date = 'La fecha es obligatoria';
        if (!lot) e.lot = 'El lote es obligatorio';
        if (!pond) e.pond = 'La piscina es obligatoria';
        if (!troutCount && troutCount !== 0) e.troutCount = 'El número de truchas es obligatorio';
        setErrors(e);
        return Object.keys(e).length === 0 ? null : e;
    };

    useEffect(() => {
        let ignore = false;
        (async () => {
            if (initial?.id) {
                const pend = await fetchPending(initial.id, 'edit');
                if (!ignore) {
                    setHasPending(!!pend?.pending);
                    setPendingReq(pend?.request ? { id: pend.request.id, hasCode: !!pend.request.hasCode, status: pend.request.status } : null);
                }
            } else {
                setHasPending(false);
                setPendingReq(null);
            }
        })();
        return () => { ignore = true; };
    }, [initial?.id]);

    useEffect(() => {
        if (!initial) {
            setDate(null);
            setLot(null);
            setPond(null);
            setTroutCount(0);
            setSheetNumber('');
            setDetail(null);
            setPackageCount(null);
            setKilos(null);
            setErrors({});
        } else {
            setDate(initial.date ? parseAPIDate(initial.date) : null);
            setKilos(parseKilosValue(initial.kilos_text) ?? null);
            setErrors({});
        }
    }, [initial]);

    const lotsCache = useRef<Map<string, { value: number; label: string }[]>>(new Map());
    const pondsCache = useRef<Map<string, { value: number; label: string }[]>>(new Map());
    const detailsCache = useRef<Map<string, { value: number; label: string }[]>>(new Map());
    const packagesCache = useRef<Map<string, { value: number; label: string }[]>>(new Map());

    // LOAD LOTS -> uses /api/lotes (as requested)
    const loadLots = useCallback(async (inputValue: string) => {
        const key = (inputValue ?? '').trim().toLowerCase();
        if (lotsCache.current.has(key)) return lotsCache.current.get(key)!;
        try {
            const q = encodeURIComponent(inputValue ?? '');
            const res = await fetch(`/api/lotes?q=${q}&limit=10`, { cache: 'no-store' });
            const json = await res.json().catch(() => null);
            const opts = (json?.data ?? []).map((it: any) => ({ value: it.id, label: it.nombre ?? it.name ?? `Lote ${it.id}` }));
            lotsCache.current.set(key, opts);
            return opts;
        } catch {
            return [];
        }
    }, []);

    // LOAD PONDS -> uses /api/pools (as requested)
    const loadPonds = useCallback(async (inputValue: string) => {
        const key = (inputValue ?? '').trim().toLowerCase();
        if (pondsCache.current.has(key)) return pondsCache.current.get(key)!;
        try {
            const q = encodeURIComponent(inputValue ?? '');
            const res = await fetch(`/api/pools?q=${q}&limit=10`, { cache: 'no-store' });
            const json = await res.json().catch(() => null);
            const opts = (json?.data ?? []).map((it: any) => ({ value: it.id, label: it.nombre ?? it.name ?? `Piscina ${it.id}` }));
            pondsCache.current.set(key, opts);
            return opts;
        } catch {
            return [];
        }
    }, []);

    // DETAILS -> endpoint: /api/details
    const loadDetails = useCallback(async (inputValue: string) => {
        const key = (inputValue ?? '').trim().toLowerCase();
        if (detailsCache.current.has(key)) return detailsCache.current.get(key)!;
        try {
            const q = encodeURIComponent(inputValue ?? '');
            const res = await fetch(`/api/details?q=${q}&limit=20`, { cache: 'no-store' });
            const json = await res.json().catch(() => null);
            const opts = (json?.data ?? []).map((it: any) => ({ value: it.id, label: it.nombre ?? it.name ?? `Detalle ${it.id}` }));
            detailsCache.current.set(key, opts);
            return opts;
        } catch {
            return [];
        }
    }, []);

    // PACKAGES -> endpoint: /api/packages
    const loadPackages = useCallback(async (inputValue: string) => {
        const key = (inputValue ?? '').trim().toLowerCase();
        if (packagesCache.current.has(key)) return packagesCache.current.get(key)!;
        try {
            const q = encodeURIComponent(inputValue ?? '');
            const res = await fetch(`/api/packages?q=${q}&limit=20`, { cache: 'no-store' });
            const json = await res.json().catch(() => null);
            const opts = (json?.data ?? []).map((it: any) => ({ value: it.id, label: it.nombre ?? it.label ?? it.name ?? `${it.id}` }));
            packagesCache.current.set(key, opts);
            return opts;
        } catch {
            return [];
        }
    }, []);

    const handleDateChange = (d: Date | null) => {
        setDate(d);
        if (!d) markError('date', 'La fecha es obligatoria');
        else markError('date');
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

    const buildPayload = (): Partial<Harvest> => {
        const dateISO = date ? date.toISOString().split('T')[0] : (null as any);
        return {
            date: dateISO,
            year: date ? date.getFullYear() : undefined,
            day_word: date ? weekdayNameFromDate(date) : undefined,
            lot_id: lot ? Number(lot.value) : (null as any),
            pond_id: pond ? Number(pond.value) : (null as any),
            trout_count: Number(troutCount),
            sheet_number: sheetNumber?.trim() || null,
            detail_id: detail ? Number(detail.value) : (null as any),
            detail_name: detail ? detail.label : null,
            package_count_id: packageCount ? Number(packageCount.value) : (null as any),
            package_count_label: packageCount ? packageCount.label : null,
            kilos_text: kilos != null ? Number(Number(kilos).toFixed(3)) : null, // numeric with up to 3 decimals
        };
    };

    const submit = async (e?: React.FormEvent) => {
        e?.preventDefault();

        if (!isEditingExisting) {
            const errs = validateCreate();
            if (errs) return;
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
            onRequestOpen(initial!.id, `Solicitud de edición - cosechas - Registro ${initial!.id}`);
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
                ? 'Editar hoja de cosecha'
                : pendingReq?.hasCode
                    ? 'Ver hoja (ingresar código)'
                    : hasPending
                        ? 'Ver hoja (pendiente de aprobación)'
                        : 'Ver hoja (solicitar edición)'
            : 'Editar hoja de cosecha'
        : 'Nueva hoja de cosecha';

    return (
        <div className={styles.modalOverlay} role="dialog" aria-modal>
            <form className={`${styles.modal} ${styles.modalWide || ''}`} onSubmit={submit}>
                <h3 className={styles.modalTitle}>{title}</h3>

                <div className={styles.modalGrid || ''} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {/* LEFT */}
                    <div>
                        <label className={styles.formLabel}>
                            Fecha
                            {mounted ? (
                                <DatePicker
                                    ref={datePickerRef}
                                    selected={date}
                                    onChange={handleDateChange}
                                    dateFormat="yyyy-MM-dd"
                                    placeholderText="Seleccionar fecha"
                                    customInput={<CustomInputControlled />}
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
                                {date ? `${weekdayNameFromDate(date)}, ${date.toLocaleDateString('es-EC', { day:'2-digit', month:'long', year:'numeric' })}` : '—'}
                            </div>
                        </label>

                        <label className={styles.formLabel}>
                            Lote (buscar)
                            <AsyncSelect
                                cacheOptions
                                defaultOptions
                                loadOptions={loadLots}
                                value={lot}
                                onChange={(v: any) => {
                                    setLot(v);
                                    if (!v) markError('lot', 'El lote es obligatorio'); else markError('lot');
                                }}
                                onBlur={() => { if (!lot) markError('lot', 'El lote es obligatorio'); }}
                                placeholder="Buscar lote por nombre o ID..."
                                isClearable
                                isDisabled={fieldsDisabled}
                                classNamePrefix="rs"
                            />
                        </label>

                        <label className={styles.formLabel}>
                            Piscina (buscar)
                            <AsyncSelect
                                cacheOptions
                                defaultOptions
                                loadOptions={loadPonds}
                                value={pond}
                                onChange={(v: any) => {
                                    setPond(v);
                                    if (!v) markError('pond', 'La piscina es obligatoria'); else markError('pond');
                                }}
                                onBlur={() => { if (!pond) markError('pond', 'La piscina es obligatoria'); }}
                                placeholder="Buscar piscina por nombre o ID..."
                                isClearable
                                isDisabled={fieldsDisabled}
                                classNamePrefix="rs"
                            />
                        </label>

                        <label className={styles.formLabel}>
                            Detalle (opcional - catálogo)
                            <AsyncSelect
                                cacheOptions
                                defaultOptions
                                loadOptions={loadDetails}
                                value={detail}
                                onChange={(v: any) => setDetail(v)}
                                placeholder="Buscar detalle..."
                                isClearable
                                isDisabled={fieldsDisabled}
                                classNamePrefix="rs"
                            />
                        </label>
                    </div>

                    {/* RIGHT */}
                    <div>
                        <label className={styles.formLabel}>
                            Nº de truchas
                            <input
                                className={styles.input}
                                type="number"
                                min={0}
                                value={troutCount}
                                onChange={(e) => setTroutCount(Number(e.target.value))}
                                disabled={fieldsDisabled}
                            />
                        </label>

                        <label className={styles.formLabel}>
                            Nº de hoja de cosecha
                            <input className={styles.input} value={sheetNumber} onChange={(e) => setSheetNumber(e.target.value)} disabled={fieldsDisabled} />
                        </label>

                        <label className={styles.formLabel}>
                            Nº paquetes (catálogo)
                            <AsyncSelect
                                cacheOptions
                                defaultOptions
                                loadOptions={loadPackages}
                                value={packageCount}
                                onChange={(v: any) => setPackageCount(v)}
                                placeholder="Seleccionar paquete..."
                                isClearable
                                isDisabled={fieldsDisabled}
                                classNamePrefix="rs"
                            />
                        </label>

                        <label className={styles.formLabel}>
                            Kilos
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <input
                                    className={styles.input}
                                    type="number"
                                    min={0}
                                    step={0.001}
                                    value={kilos ?? ''}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === '') setKilos(null);
                                        else setKilos(Number(val));
                                    }}
                                    disabled={fieldsDisabled}
                                    placeholder="Ej: 23.5"
                                />
                                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>kg</div>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                                Número — hasta 3 decimales.
                            </div>
                        </label>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                        {isEditingExisting ? `Registro ID: ${initial?.id}` : 'Nuevo registro (año se obtiene desde la fecha)'}
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
                                        onClick={() => onRequestOpen(initial!.id, `Solicitud de edición - cosechas - Registro ${initial!.id}`)}
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

/* Custom date input used in filters and forms */
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
