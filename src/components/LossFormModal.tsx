'use client';

import React, { useEffect, useState } from 'react';
import styles from '@/app/losses/losses.module.css';
import Swal from 'sweetalert2';

type Loss = {
    id?: number;
    lote_id?: number | null;
    piscina_id?: number | null;
    fecha?: string;
    muertos?: number;
    faltantes?: number;
    sobrantes?: number;
    deformes?: number;
};

async function parseResponseOrThrow(res: Response) {
    const json = await res.json().catch(() => null);
    if (res.ok) return json;
    const msg = json?.msg || res.statusText || 'Error del servidor';
    const err: any = new Error(msg);
    err.status = res.status;
    err.json = json;
    throw err;
}

export default function LossFormModal({
                                          open,
                                          initial,
                                          onClose,
                                          onSaved,
                                      }: {
    open: boolean;
    initial?: Partial<Loss>;
    onClose: () => void;
    onSaved?: (saved: any) => void;
}) {
    const [loteId, setLoteId] = useState<string>(String(initial?.lote_id ?? ''));
    const [piscinaId, setPiscinaId] = useState<string>(String(initial?.piscina_id ?? ''));
    const [fecha, setFecha] = useState<string>(initial?.fecha ? initial.fecha.slice(0, 10) : '');
    const [muertos, setMuertos] = useState<string>(String(initial?.muertos ?? '0'));
    const [faltantes, setFaltantes] = useState<string>(String(initial?.faltantes ?? '0'));
    const [sobrantes, setSobrantes] = useState<string>(String(initial?.sobrantes ?? '0'));
    const [deformes, setDeformes] = useState<string>(String(initial?.deformes ?? '0'));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setLoteId(String(initial?.lote_id ?? ''));
            setPiscinaId(String(initial?.piscina_id ?? ''));
            setFecha(initial?.fecha ? initial.fecha.slice(0, 10) : '');
            setMuertos(String(initial?.muertos ?? '0'));
            setFaltantes(String(initial?.faltantes ?? '0'));
            setSobrantes(String(initial?.sobrantes ?? '0'));
            setDeformes(String(initial?.deformes ?? '0'));
            setError(null);
        }
    }, [open, initial]);

    if (!open) return null;

    const isEdit = !!initial?.id;

    const submit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        setError(null);

        if (!fecha) {
            setError('Fecha requerida (YYYY-MM-DD)');
            return;
        }

        setLoading(true);
        try {
            const body = {
                lote_id: loteId ? Number(loteId) : null,
                piscina_id: piscinaId ? Number(piscinaId) : null,
                fecha,
                muertos: Number(muertos || 0),
                faltantes: Number(faltantes || 0),
                sobrantes: Number(sobrantes || 0),
                deformes: Number(deformes || 0),
            };

            let res: Response;
            if (isEdit && initial?.id) {
                res = await fetch(`/api/losses/${initial.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            } else {
                res = await fetch(`/api/losses`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            }
            const json = await parseResponseOrThrow(res);
            onSaved?.(json.data);
        } catch (err: any) {
            console.error(err);
            if (err?.status === 409) {
                setError(err.message || 'Conflicto');
            } else {
                setError(err?.message ?? 'Error en servidor');
                Swal.fire('Error', err?.message ?? 'Error en servidor', 'error');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
            <form className={styles.modal} onSubmit={submit}>
                <h3 className={styles.modalTitle}>{isEdit ? 'Editar baja' : 'Nueva baja'}</h3>

                <label className={styles.formLabel}>
                    Fecha
                    <input className={styles.input} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
                </label>

                <label className={styles.formLabel}>
                    Nº de Lote (ID)
                    <input className={styles.input} value={loteId} onChange={(e) => setLoteId(e.target.value.replace(/\D/g, ''))} placeholder="ID del lote (opcional)" />
                </label>

                <label className={styles.formLabel}>
                    Piscina (ID)
                    <input className={styles.input} value={piscinaId} onChange={(e) => setPiscinaId(e.target.value.replace(/\D/g, ''))} placeholder="ID de la piscina (opcional)" />
                </label>

                <label className={styles.formLabel}>
                    Muertos
                    <input className={styles.input} value={muertos} onChange={(e) => setMuertos(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
                </label>

                <label className={styles.formLabel}>
                    Faltantes
                    <input className={styles.input} value={faltantes} onChange={(e) => setFaltantes(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
                </label>

                <label className={styles.formLabel}>
                    Sobrantes
                    <input className={styles.input} value={sobrantes} onChange={(e) => setSobrantes(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
                </label>

                <label className={styles.formLabel}>
                    Deformes
                    <input className={styles.input} value={deformes} onChange={(e) => setDeformes(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
                </label>

                {error && <div className={styles.formError}>{error}</div>}

                <div className={styles.modalActions}>
                    <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={loading}>Cancelar</button>
                    <button type="submit" className={styles.btnPrimary} disabled={loading}>{loading ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear baja'}</button>
                </div>
            </form>
        </div>
    );
}
