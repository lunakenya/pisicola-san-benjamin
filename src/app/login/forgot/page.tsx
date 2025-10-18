'use client';

import { useState } from 'react';
import Link from 'next/link';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import styles from '../styles.module.css';

const Toast = Swal.mixin({
    toast: true, position: 'top-end', showConfirmButton: false, timer: 4000, timerProgressBar: true, background: '#fff',
});
async function parseResponseOrThrow(res: Response) {
    const json = await res.json().catch(() => null);
    if (res.ok) return json;
    const err = new Error(json?.msg || res.statusText || 'Error del servidor') as any;
    err.status = res.status; err.json = json; throw err;
}

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            Toast.fire({ icon: 'warning', title: 'Email inválido' }); return;
        }
        setLoading(true);
        try {
            await parseResponseOrThrow(await fetch('/api/password/forgot', {
                method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email }),
            }));
            // Respuesta genérica (no revela existencia)
            Toast.fire({ icon:'success', title:'Si el correo existe, te enviamos un código' });
        } catch (e:any) {
            Toast.fire({ icon:'error', title: e?.message ?? 'Error' });
        } finally { setLoading(false); }
    };

    return (
        <div className={styles.containerCenter}>
            <div className={styles.singleCardLarge}>
                <h2 className={styles.titleCenter}>Recuperar contraseña</h2>

                <form onSubmit={submit} className={styles.singleForm} noValidate>
                    <label className={styles.singleLabel}>
                        Correo electrónico
                        <input
                            type="email"
                            className={styles.input}
                            placeholder="tu@correo.com"
                            value={email}
                            onChange={(e)=>setEmail(e.target.value)}
                            required inputMode="email" pattern="^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"
                            disabled={loading}
                        />
                    </label>

                    <button type="submit" className={styles.btnPrimaryWide} disabled={loading}>
                        {loading ? 'Enviando…' : 'Enviar código'}
                    </button>

                    <div className={styles.linksRowSpread}>
                        <Link href="/login/reset" className={styles.linkStrong}>Ingresar código</Link>
                        <Link href="/login" className={styles.backButton}>← Volver al login</Link>
                    </div>
                </form>
            </div>
        </div>
    );
}
