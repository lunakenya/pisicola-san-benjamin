'use client';

import React, { useEffect, useState } from 'react';
import styles from './modal.module.css';
import Swal from 'sweetalert2';

export default function VerifyCodeModal({
                                            id,
                                            open,
                                            onClose,
                                            onVerified,
                                        }: {
    id?: number | null;
    open: boolean;
    onClose: () => void;
    onVerified?: (solicitudId?: number, registroId?: number) => void;
}) {
    const [codigo, setCodigo] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setCodigo('');
            setError(null);
        }
    }, [open, id]);

    if (!open || !id) return null;

    const submit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        setError(null);
        if (!codigo.trim()) {
            setError('Código requerido');
            return;
        }
        setLoading(true);
        try {
            const res = await fetch(`/api/edit-requests/${id}/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ codigo: String(codigo).trim() }),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.success) {
                throw new Error(json?.msg || 'Código inválido');
            }

            onVerified?.(id, undefined);
            Swal.fire('Verificado', 'Código correcto. Ya puede editar el registro.', 'success');
        } catch (e: any) {
            console.error(e);
            setError(e?.message ?? 'Error verificando');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
            <form className={styles.modal} onSubmit={submit}>
                <h3 className={styles.modalTitle}>Ingresar código</h3>
                <p className={styles.modalText}>Ingrese el código de autorización que le fue enviado por el administrador.</p>

                <label className={styles.formLabel}>
                    Código de 4 dígitos
                    <input
                        className={styles.input}
                        value={codigo}
                        onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
                        inputMode="numeric"
                        maxLength={6}
                        autoFocus
                    />
                </label>

                {error && <div className={styles.formError}>{error}</div>}

                <div className={styles.modalActions}>
                    <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={loading}>Cancelar</button>
                    <button type="submit" className={styles.btnPrimary} disabled={loading}>{loading ? 'Verificando...' : 'Verificar código'}</button>
                </div>
            </form>
        </div>
    );
}
