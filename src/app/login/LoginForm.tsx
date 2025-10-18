'use client';

import React, { useState } from 'react';
import styles from './styles.module.css';
import Image from 'next/image';
import Link from 'next/link';
import { FaUser, FaLock, FaEye, FaEyeSlash } from 'react-icons/fa';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 4000,
    timerProgressBar: true,
    background: '#fff',
});

async function parseResponseOrThrow(res: Response) {
    const json = await res.json().catch(() => null);
    if (res.ok) return json;
    const msg = json?.msg || res.statusText || 'Error del servidor';
    const err = new Error(msg) as any;
    err.status = res.status;
    err.json = json;
    throw err;
}

export default function LoginForm() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validaciones rápidas en el front
        if (!email.trim()) {
            Toast.fire({ icon: 'warning', title: 'Email requerido' });
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            Toast.fire({ icon: 'warning', title: 'Email inválido (falta "@")' });
            return;
        }
        if (!password.trim()) {
            Toast.fire({ icon: 'warning', title: 'Contraseña requerida' });
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const json = await parseResponseOrThrow(res);

            Toast.fire({ icon: 'success', title: '¡Bienvenido!' });
            // Redirige después de un pequeño delay para que se vea el toast
            setTimeout(() => { window.location.href = '/catalogs'; }, 350);
        } catch (err: any) {
            // Muestra el mensaje del backend: "Usuario no encontrado", "Contraseña incorrecta", etc.
            Toast.fire({ icon: 'error', title: err?.message ?? 'Error al iniciar sesión' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                {/* Lado izquierdo: imagen + logo */}
                <div className={styles.left}>
                    <Image src="/images/card.png" alt="Decoración" fill className={styles.cardImage} />
                    <Image
                        src="/images/logo.png"
                        alt="Logo San Benjamín"
                        width={250}
                        height={250}
                        className={styles.logo}
                        priority
                    />
                </div>

                {/* Lado derecho */}
                <div className={styles.right}>
                    <h2 className={styles.welcome}>
                        Bienvenido a <span className={styles.benjamin}>Benjamín</span>
                    </h2>

                    <form onSubmit={handleLogin} className={styles.form} noValidate>
                        <div className={styles.row}>
                            <FaUser className={styles.leftIcon} aria-hidden />
                            <input
                                type="email"
                                className={styles.input}
                                placeholder="Usuario"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                inputMode="email"
                                pattern="^[^\s@]+@[^\s@]+\.[^\s@]+$"
                                autoComplete="username"
                                disabled={loading}
                            />
                        </div>

                        <div className={styles.row}>
                            <FaLock className={styles.leftIcon} aria-hidden />
                            <input
                                type={showPass ? 'text' : 'password'}
                                className={styles.input}
                                placeholder="Contraseña"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                minLength={1}
                                autoComplete="current-password"
                                disabled={loading}
                            />
                            <button
                                type="button"
                                className={styles.eyeBtn}
                                onClick={() => setShowPass(v => !v)}
                                aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                disabled={loading}
                            >
                                {showPass ? <FaEyeSlash /> : <FaEye />}
                            </button>
                        </div>

                        <a className={styles.forgot} href="/login/forgot">¿Olvidaste la contraseña?</a>

                        <button type="submit" className={styles.loginButton} disabled={loading}>
                            {loading ? 'Ingresando…' : 'Ingresar'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
