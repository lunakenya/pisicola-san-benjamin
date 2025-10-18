// app/login/reset/page.tsx
'use client';

import React, { useMemo, useState } from 'react';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import styles from '../styles-simple-card.module.css';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const Toast = Swal.mixin({
    toast: true, position: 'top-end', showConfirmButton: false,
    timer: 4000, timerProgressBar: true, background: '#fff',
});

async function parseResponseOrThrow(res: Response) {
    const json = await res.json().catch(()=>null);
    if (res.ok) return json;
    const err = new Error(json?.msg || res.statusText || 'Error'); (err as any).status=res.status;
    throw err;
}

export default function VerifyCodePage() {
    const sp = useSearchParams();
    const emailFromQuery = useMemo(()=> (sp?.get('email') ?? '').trim(), [sp]);

    const [email, setEmail] = useState(emailFromQuery);
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();

        const em = (email || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em))
            return Toast.fire({ icon:'warning', title:'Email inválido' });

        if (!/^\d{6}$/.test(code))
            return Toast.fire({ icon:'warning', title:'Código inválido (6 dígitos)' });

        setLoading(true);
        try {
            const res = await fetch('/api/password/verify', {
                method: 'POST',
                headers: { 'Content-Type':'application/json' },
                body: JSON.stringify({ email: em, code: code.trim() }),
            });
            await parseResponseOrThrow(res);

            Toast.fire({ icon:'success', title:'Código verificado' });
            // Cookie httpOnly ya quedó puesta → ir a crear nueva contraseña
            setTimeout(() => { window.location.href = '/login/new-password'; }, 350);
        } catch (e:any) {
            Toast.fire({ icon:'error', title: e?.message ?? 'Verificación fallida' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.bg}>
            <div className={styles.card}>
                <h2 className={styles.title}>Verificar código</h2>

                <form onSubmit={submit} className={styles.form} noValidate>
                    {/* Email: se oculta si vino por query */}
                    {!emailFromQuery && (
                        <label className={styles.label}>
                            Correo electrónico
                            <input
                                className={styles.input}
                                type="email"
                                value={email}
                                onChange={(e)=>setEmail(e.target.value)}
                                required
                                inputMode="email"
                                placeholder="correo@ejemplo.com"
                                disabled={loading}
                            />
                        </label>
                    )}

                    <label className={styles.label}>
                        Código (6 dígitos)
                        <input
                            className={styles.input}
                            value={code}
                            onChange={(e)=>setCode(e.target.value.replace(/\D/g,''))}
                            maxLength={6}
                            inputMode="numeric"
                            placeholder="000000"
                            disabled={loading}
                            required
                        />
                    </label>

                    <button className={styles.primaryBtn} type="submit" disabled={loading}>
                        {loading ? 'Verificando…' : 'Verificar'}
                    </button>

                    <div className={styles.actionsRow}>
                        <Link href="/login/forgot" className={styles.linkStrong}>¿No recibiste el código?</Link>
                        <Link href="/login" className={styles.backLink}>← Volver al login</Link>
                    </div>
                </form>
            </div>
        </div>
    );
}
