'use client';

import React, { useEffect, useState } from 'react';
import styles from '@/app/losses/losses.module.css';

type SummaryRow = {
    lote_id: number | null;
    lote_nombre?: string | null;
    registros: number;
    muertos_total: number;
    faltantes_total: number;
    sobrantes_total: number;
    deformes_total: number;
};

export default function LossSummary({
                                        desde,
                                        hasta,
                                        q,
                                        includeInactive,
                                        onClickRow,
                                    }: {
    desde?: string;
    hasta?: string;
    q?: string;
    includeInactive?: boolean;
    onClickRow?: (r: SummaryRow) => void;
}) {
    const [rows, setRows] = useState<SummaryRow[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let mounted = true;
        async function load() {
            setLoading(true);
            try {
                // Intentamos endpoint /api/losses/summary (si existe). Si no, fallback a GET /api/losses con pageSize grande.
                const params = new URLSearchParams();
                if (desde) params.set('desde', desde);
                if (hasta) params.set('hasta', hasta);
                if (q) params.set('q', q);
                if (includeInactive) params.set('includeInactive', 'true');

                const trySummary = await fetch(`/api/losses/summary?${params.toString()}`, { cache: 'no-store' });
                if (trySummary.ok) {
                    const js = await trySummary.json();
                    if (js?.success && Array.isArray(js.data)) {
                        if (mounted) setRows(js.data);
                        setLoading(false);
                        return;
                    }
                }

                // Fallback: traer muchos registros y agrupar localmente
                const big = await fetch(`/api/losses?page=1&pageSize=1000&${params.toString()}`, { cache: 'no-store' });
                const jb = await big.json().catch(() => null);
                const data = jb?.data ?? [];
                const map = new Map<number | string, SummaryRow>();
                for (const r of data) {
                    const key = r.lote_id ?? '__no_lote';
                    const existing = map.get(key) as SummaryRow | undefined;
                    const loteNombre = r.lote_nombre ?? (r.lote_id ? `Lote ${r.lote_id}` : '—');
                    if (!existing) {
                        map.set(key, {
                            lote_id: r.lote_id ?? null,
                            lote_nombre: loteNombre,
                            registros: 1,
                            muertos_total: Number(r.muertos ?? 0),
                            faltantes_total: Number(r.faltantes ?? 0),
                            sobrantes_total: Number(r.sobrantes ?? 0),
                            deformes_total: Number(r.deformes ?? 0),
                        });
                    } else {
                        existing.registros += 1;
                        existing.muertos_total += Number(r.muertos ?? 0);
                        existing.faltantes_total += Number(r.faltantes ?? 0);
                        existing.sobrantes_total += Number(r.sobrantes ?? 0);
                        existing.deformes_total += Number(r.deformes ?? 0);
                    }
                }
                if (mounted) setRows(Array.from(map.values()));
            } catch (e) {
                console.error('Load summary error', e);
            } finally {
                if (mounted) setLoading(false);
            }
        }
        load();
        return () => { mounted = false; };
    }, [desde, hasta, q, includeInactive]);

    return (
        <div className={styles.summaryCard}>
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>RESUMEN MUERTOS</h3>
            {loading ? (
                <div style={{ color: 'var(--text-muted)' }}>Cargando resumen...</div>
            ) : rows.length === 0 ? (
                <div style={{ color: 'var(--text-muted)' }}>Sin datos</div>
            ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {rows.map((r) => (
                            <button
                                key={String(r.lote_id ?? 'nolote')}
                                onClick={() => onClickRow?.(r)}
                                style={{
                                    border: '1px solid rgba(12,120,80,0.12)',
                                    padding: 10,
                                    borderRadius: 8,
                                    background: 'white',
                                    cursor: 'pointer',
                                    minWidth: 180,
                                    textAlign: 'left',
                                }}
                                title={`Filtrar por lote ${r.lote_nombre}`}
                            >
                                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{r.lote_nombre ?? '—'}</div>
                                <div style={{ fontWeight: 700, marginTop: 6 }}>{r.muertos_total} muertos</div>
                                <div style={{ fontSize: 12, marginTop: 6, color: 'var(--text-muted)' }}>
                                    {r.registros} registros · {r.faltantes_total} faltantes · {r.sobrantes_total} sobrantes
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
