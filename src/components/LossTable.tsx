'use client';

import React, { useEffect, useState } from 'react';
import styles from '@/app/losses/losses.module.css';
import { FiEdit2, FiTrash2 } from 'react-icons/fi';
import Swal from 'sweetalert2';

type Loss = {
    id: number;
    lote_id?: number | null;
    piscina_id?: number | null;
    fecha: string;
    muertos: number;
    faltantes: number;
    sobrantes: number;
    deformes: number;
    lote_nombre?: string | null;
    piscina_nombre?: string | null;
    active?: boolean;
};

export default function LossTable({
                                      q,
                                      includeInactive,
                                      filters,
                                      onRequestCreate,
                                      onEditRequest,
                                      onOpenVerify,
                                      onSaved,
                                  }: {
    q?: string;
    includeInactive?: boolean;
    filters?: { lote_id?: number | null };
    onRequestCreate?: (lossId: number) => void;
    onEditRequest?: (loss: Loss) => void;
    onOpenVerify?: (solicitudId: number, callback?: () => void) => void;
    onSaved?: (saved: Loss) => void;
}) {
    const [data, setData] = useState<Loss[]>([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(50);
    const [total, setTotal] = useState(0);
    const [confirmLoadingId, setConfirmLoadingId] = useState<number | null>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('page', String(page));
            params.set('pageSize', String(pageSize));
            if (q) params.set('q', q);
            if (includeInactive) params.set('includeInactive', 'true');
            if (filters?.lote_id) params.set('lote_id', String(filters.lote_id));

            const res = await fetch(`/api/losses?${params.toString()}`, { cache: 'no-store' });
            const j = await res.json().catch(() => null);
            if (j?.success) {
                setData(j.data ?? []);
                setTotal(j.total ?? 0);
            } else {
                setData([]);
            }
        } catch (e) {
            console.error('fetchLosses', e);
            setData([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setPage(1);
    }, [q, includeInactive, JSON.stringify(filters)]);

    useEffect(() => {
        void fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, q, includeInactive, JSON.stringify(filters)]);

    const askToggleActive = async (loss: Loss) => {
        const action = loss.active ? 'Inactivar' : 'Restaurar';
        const res = await Swal.fire({
            title: `${action} registro`,
            html: loss.active
                ? `¿Inactivar el registro del lote <b>${loss.lote_nombre ?? loss.lote_id}</b> (ID ${loss.id})?`
                : `¿Restaurar el registro ID ${loss.id}?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: action,
            cancelButtonText: 'Cancelar',
        });
        if (!res.isConfirmed) return;

        setConfirmLoadingId(loss.id);
        try {
            if (loss.active) {
                await fetch(`/api/losses/${loss.id}`, { method: 'DELETE' });
            } else {
                await fetch(`/api/losses/${loss.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ active: true }),
                });
            }
            Swal.fire('OK', 'Estado actualizado', 'success');
            void fetchData();
        } catch (e) {
            console.error(e);
            Swal.fire('Error', 'No se pudo actualizar', 'error');
        } finally {
            setConfirmLoadingId(null);
        }
    };

    // When user clicks "Editar", delegate to parent to decide flow (operador vs admin)
    const handleEditClick = (loss: Loss) => {
        onEditRequest?.(loss);
    };

    // Button "Solicitar autorización"
    const handleRequest = (loss: Loss) => {
        onRequestCreate?.(loss.id);
    };

    return (
        <div className={styles.tableCard}>
            {loading ? (
                <div className={styles.loading}>Cargando...</div>
            ) : (
                <>
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
                            <tr>
                                <td colSpan={9} className={styles.emptyRow}>Sin registros</td>
                            </tr>
                        ) : (
                            data.map((r) => (
                                <tr key={r.id}>
                                    <td className={styles.cell}>{new Date(r.fecha).toLocaleDateString()}</td>
                                    <td className={styles.cell}>{r.lote_nombre ?? r.lote_id ?? '—'}</td>
                                    <td className={styles.cell}>{r.piscina_nombre ?? r.piscina_id ?? '—'}</td>
                                    <td className={styles.cellCenter}>{r.muertos}</td>
                                    <td className={styles.cellCenter}>{r.faltantes}</td>
                                    <td className={styles.cellCenter}>{r.sobrantes}</td>
                                    <td className={styles.cellCenter}>{r.deformes}</td>
                                    <td className={styles.cellCenter}>{r.mes ?? '-'}</td>
                                    <td className={styles.cellActions}>
                                        <button className={styles.smallBtn} title="Editar" onClick={() => handleEditClick(r)}>
                                            <FiEdit2 />
                                            <span>Editar</span>
                                        </button>

                                        <button
                                            className={styles.smallBtnAlt}
                                            onClick={() => askToggleActive(r)}
                                            disabled={confirmLoadingId === r.id}
                                        >
                                            <FiTrash2 />
                                            <span style={{ marginLeft: 6 }}>{r.active ? 'Inactivar' : 'Restaurar'}</span>
                                        </button>
                                        {/* small helper to request authorization quickly */}
                                        <button className={styles.smallBtnAlt} onClick={() => handleRequest(r)} title="Solicitar autorización">
                                            Solicitar
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                        </tbody>
                    </table>

                    {/* simple pagination */}
                    <div style={{ display: 'flex', gap: 8, padding: 12, alignItems: 'center', justifyContent: 'flex-end' }}>
                        <div style={{ color: 'var(--text-muted)' }}>Total: {total}</div>
                        <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Anterior</button>
                        <div>Pagina {page}</div>
                        <button onClick={() => setPage((p) => p + 1)} disabled={data.length < 1}>Siguiente</button>
                    </div>
                </>
            )}
        </div>
    );
}
