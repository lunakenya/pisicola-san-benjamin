// app/login/new-password/page.tsx
'use client';

import React, { useState } from 'react';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import styles from '../styles-simple-card.module.css';
import Link from 'next/link';

const Toast = Swal.mixin({
    toast:true, position:'top-end', showConfirmButton:false,
    timer:4000, timerProgressBar:true, background:'#fff'
});

async function parseResponseOrThrow(res: Response) {
    const json = await res.json().catch(()=>null);
    if (res.ok) return json;
    const err = new Error(json?.msg || res.statusText || 'Error'); (err as any).status=res.status;
    throw err;
}

export default function NewPasswordPage() {
    const [pass1, setPass1] = useState('');
    const [pass2, setPass2] = useState('');
    const [loading, setLoading] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (pass1.length < 6)
            return Toast.fire({ icon:'warning', title:'Mínimo 6 caracteres' });
        if (pass1 !== pass2)
            return Toast.fire({ icon:'warning', title:'Las contraseñas no coinciden' });

        setLoading(true);
        try {
            const res = await fetch('/api/password/reset', {
                method: 'POST',
                headers: { 'Content-Type':'application/json' },
                body: JSON.stringify({ password: pass1 }),
            });
            await parseResponseOrThrow(res);

            Toast.fire({ icon:'success', title:'Contraseña actualizada' });
            setTimeout(()=>{ window.location.href = '/login?reset=1'; }, 500);
        } catch (e:any) {
            Toast.fire({ icon:'error', title: e?.message ?? 'No se pudo actualizar' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.bg}>
            <div className={styles.card}>
                <h2 className={styles.title}>Nueva contraseña</h2>

                <form onSubmit={submit} className={styles.form} noValidate>
                    <label className={styles.label}>
                        Nueva contraseña
                        <input
                            className={styles.input}
                            type="password"
                            value={pass1}
                            onChange={(e)=>setPass1(e.target.value)}
                            minLength={6}
                            required
                            disabled={loading}
                        />
                    </label>

                    <label className={styles.label}>
                        Repetir contraseña
                        <input
                            className={styles.input}
                            type="password"
                            value={pass2}
                            onChange={(e)=>setPass2(e.target.value)}
                            minLength={6}
                            required
                            disabled={loading}
                        />
                    </label>

                    <button className={styles.primaryBtn} type="submit" disabled={loading}>
                        {loading ? 'Guardando…' : 'Guardar'}
                    </button>

                    <div className={styles.actionsRow}>
                        <Link href="/login" className={styles.backLink}>← Volver al login</Link>
                    </div>
                </form>
            </div>
        </div>
    );
}
