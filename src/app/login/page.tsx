// app/login/page.tsx
'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import LoginForm from './LoginForm';

export default function LoginPage() {
    const searchParams = useSearchParams();

    useEffect(() => {
        if (searchParams?.get('logged_out') === '1') {
            const Toast = Swal.mixin({
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 1400,
                timerProgressBar: true,
                background: '#fff',
                didOpen: (t) => {
                    t.addEventListener('mouseenter', Swal.stopTimer);
                    t.addEventListener('mouseleave', Swal.resumeTimer);
                },
            });
            Toast.fire({ icon: 'success', title: 'Has cerrado sesión correctamente' });

            if (typeof window !== 'undefined') {
                const u = new URL(window.location.href);
                u.searchParams.delete('logged_out');
                window.history.replaceState({}, '', u.toString());
            }
        }
    }, [searchParams]);

    return (
        <div className="login-wrapper">
            <LoginForm />
        </div>
    );
}
