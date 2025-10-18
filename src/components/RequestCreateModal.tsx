'use client';

import React, { useEffect, useState } from 'react';
import styles from '@/app/losses/losses.module.css';

export default function RequestCreateModal({
                                               open,
                                               initial,
                                               onClose,
                                               onCreated,
                                           }: {
    open: boolean;
    initial?: { tabla?: string; registro_id?: number };
    onClose: () => void;
    onCreated?: (data?: any) => void;
}) {
    const [tabla, setTabla] = useState(initial?.tabla ?? 'bajas');
    const [registroId, setRegistroId] = useState(initial?.registro_id ? String(initial.registro_id) : '');
    const [motivo, setMotivo] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setTabla(initial?.tabla ?? 'bajas');
            setRegistroId(initial?.registro_id ? String(initial?.registro_id) : '');
            setMotivo('');
            setError(null);
        }
    }, [open, initial]);

    if (!open) return null;

    const submit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        setError(null);
        if (!registroId || !motivo.trim()) {
            setError('Registro y motivo son requeridos');
            return;
        }
        setLoading(true);
        try {
            const res = await fetch('/api/edit-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tabla, registro_id: Number(registroId), motivo: motivo.trim() }),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.success) {
                throw new Error(json?.msg || 'Error al crear solicitud');
            }
            onCreated?.(json.data);
        } catch (e: any) {
            setError(e?.message ?? 'Error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
            <form className={styles.modal} onSubmit={submit}>
                <h3 className={styles.modalTitle}>Solicitar autorización</h3>
                <p className={styles.modalText}>Enviaremos una solicitud al administrador para que pueda aprobar cambios en este registro.</p>

                <label className={styles.formLabel}>
                    Tabla
                    <input className={styles.input} value={tabla} onChange={(e) => setTabla(e.target.value)} />
                </label>

                <label className={styles.formLabel}>
                    Registro (ID)
                    <input className={styles.input} value={registroId} onChange={(e) => setRegistroId(e.target.value.replace(/\D/g, ''))} />
                </label>

                <label className={styles.formLabel}>
                    Motivo
                    <textarea className={styles.input} value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ minHeight: 100 }} />
                </label>

                {error && <div className={styles.formError}>{error}</div>}

                <div className={styles.modalActions}>
                    <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={loading}>Cancelar</button>
                    <button type="submit" className={styles.btnPrimary} disabled={loading}>{loading ? 'Enviando...' : 'Enviar solicitud'}</button>
                </div>
            </form>
        </div>
    );
}
