'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from './users.module.css';
import { FiRefreshCw, FiPlus, FiSearch, FiEdit2, FiTrash2, FiKey } from 'react-icons/fi';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

type User = { id: number; nombre: string; email: string; rol: 'SUPERADMIN'|'OPERADOR'; active: boolean };

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
    err.status = res.status; err.json = json;
    throw err;
}

/* ================= Modal Crear/Editar ================= */
function UserFormModal({
                           open, initial, onClose, onSaved,
                       }: {
    open: boolean;
    initial?: Partial<User>;
    onClose: () => void;
    onSaved: (u: User) => void;
}) {
    const isEdit = !!initial?.id;

    const [nombre, setNombre]   = useState(initial?.nombre ?? '');
    const [email, setEmail]     = useState(initial?.email ?? '');
    const [rol, setRol]         = useState<User['rol']>((initial?.rol as any) ?? 'OPERADOR');

    // password: requerido al crear; opcional en edición con “reset”
    const [password, setPassword]   = useState('');
    const [resetPass, setResetPass] = useState(false);

    const [loading, setLoading]   = useState(false);
    const [serverError, setServerError] = useState<string|null>(null);

    // errores por campo
    type FormErrors = { nombre?: string; email?: string; password?: string };
    const [errors, setErrors] = useState<FormErrors>({});

    useEffect(() => {
        if (open) {
            setNombre(initial?.nombre ?? '');
            setEmail(initial?.email ?? '');
            setRol((initial?.rol as any) ?? 'OPERADOR');
            setPassword('');
            setResetPass(false);
            setServerError(null);
            setErrors({});
        }
    }, [open, initial]);

    if (!open) return null;

    const validate = (): FormErrors => {
        const e: FormErrors = {};
        if (!nombre.trim()) e.nombre = 'Nombre requerido';
        if (!email.trim()) e.email = 'Email requerido';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'Email inválido (debe incluir @)';
        if (!isEdit && password.trim().length < 6) e.password = 'Contraseña mínima de 6 caracteres';
        if (isEdit && resetPass && password.trim().length < 6) e.password = 'Nueva contraseña mínima de 6 caracteres';
        return e;
    };

    const submit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        setServerError(null);

        const eMap = validate();
        setErrors(eMap);
        if (Object.keys(eMap).length) return; // No enviar si hay errores

        setLoading(true);
        try {
            if (isEdit && initial?.id) {
                const body: any = { nombre: nombre.trim(), email: email.trim(), rol };
                if (resetPass) body.password = password.trim();

                const res = await fetch(`/api/users/${initial.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const json = await parseResponseOrThrow(res);
                onSaved(json.data);
                Toast.fire({ icon: 'success', title: resetPass ? 'Usuario y contraseña actualizados' : 'Usuario actualizado' });
            } else {
                const res = await fetch('/api/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre: nombre.trim(), email: email.trim(), password: password.trim(), rol }),
                });
                const json = await parseResponseOrThrow(res);
                onSaved(json.data);
                Toast.fire({ icon: 'success', title: 'Usuario creado' });
            }
            onClose();
        } catch (err: any) {
            setServerError(err?.message ?? 'Error en servidor');
            Toast.fire({ icon: 'error', title: err?.message ?? 'Error en servidor' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
            <form className={styles.modal} onSubmit={submit} noValidate>
                <h3 className={styles.modalTitle}>{isEdit ? 'Editar usuario' : 'Nuevo usuario'}</h3>

                <label className={styles.formLabel}>
                    Nombre
                    <input
                        className={styles.input}
                        value={nombre}
                        onChange={(e)=>{ setNombre(e.target.value); if (errors.nombre) setErrors({ ...errors, nombre: undefined }); }}
                        autoFocus
                        required
                    />
                    {errors.nombre && <span className={styles.fieldError}>{errors.nombre}</span>}
                </label>

                <label className={styles.formLabel}>
                    Email
                    <input
                        className={styles.input}
                        type="email"
                        value={email}
                        onChange={(e)=>{ setEmail(e.target.value); if (errors.email) setErrors({ ...errors, email: undefined }); }}
                        required
                        inputMode="email"
                        pattern="^[^\s@]+@[^\s@]+\.[^\s@]+$"
                    />
                    {errors.email && <span className={styles.fieldError}>{errors.email}</span>}
                </label>

                <label className={styles.formLabel}>
                    Rol
                    <select
                        className={styles.input}
                        value={rol}
                        onChange={(e)=>setRol(e.target.value as User['rol'])}
                        required
                    >
                        <option value="OPERADOR">OPERADOR</option>
                        <option value="SUPERADMIN">SUPERADMIN</option>
                    </select>
                </label>

                {!isEdit && (
                    <label className={styles.formLabel}>
                        Contraseña (mín. 6)
                        <input
                            className={styles.input}
                            type="password"
                            value={password}
                            onChange={(e)=>{ setPassword(e.target.value); if (errors.password) setErrors({ ...errors, password: undefined }); }}
                            required
                            minLength={6}
                        />
                        {errors.password && <span className={styles.fieldError}>{errors.password}</span>}
                    </label>
                )}

                {isEdit && (
                    <div className={styles.resetPassBox}>
                        <label className={styles.checkRow}>
                            <input
                                type="checkbox"
                                checked={resetPass}
                                onChange={(e)=>{ setResetPass(e.target.checked); setPassword(''); setErrors({ ...errors, password: undefined }); }}
                            />
                            <span>Resetear contraseña</span>
                        </label>

                        {resetPass && (
                            <>
                                <input
                                    className={styles.input}
                                    type="password"
                                    placeholder="Nueva contraseña (mín. 6)"
                                    value={password}
                                    onChange={(e)=>{ setPassword(e.target.value); if (errors.password) setErrors({ ...errors, password: undefined }); }}
                                    required
                                    minLength={6}
                                />
                                {errors.password && <span className={styles.fieldError}>{errors.password}</span>}
                            </>
                        )}
                    </div>
                )}

                {serverError && <div className={styles.formError}>{serverError}</div>}

                <div className={styles.modalActions}>
                    <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={loading}>Cancelar</button>
                    <button type="submit" className={styles.btnPrimary} disabled={loading}>
                        {loading ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear usuario'}
                    </button>
                </div>
            </form>
        </div>
    );
}

/* ================= Página ================= */
export default function UsersPage() {
    const [data, setData] = useState<User[]>([]);
    const [initialLoading, setInitialLoading] = useState(true);
    const [loadingList, setLoadingList] = useState(false);

    const [q, setQ] = useState(''); const [debouncedQ, setDebouncedQ] = useState('');
    const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(10);
    const [total, setTotal] = useState(0); const [pages, setPages] = useState(1);
    const [showInactive, setShowInactive] = useState(false);

    const [openForm, setOpenForm] = useState(false);
    const [formInitial, setFormInitial] = useState<Partial<User>|undefined>(undefined);

    const abortRef = useRef<AbortController|null>(null);

    useEffect(()=>{ const t = setTimeout(()=>setDebouncedQ(q.trim()), 250); return ()=>clearTimeout(t); },[q]);
    useEffect(()=>{ setPage(1); },[debouncedQ, showInactive]);
    useEffect(()=>{ void fetchData({ initial: initialLoading }); /* eslint-disable-next-line */ },[page, pageSize, debouncedQ, showInactive]);

    async function fetchData({ initial=false }: { initial?: boolean } = {}) {
        if (abortRef.current) abortRef.current.abort();
        const ac = new AbortController(); abortRef.current = ac;
        if (initial) setInitialLoading(true); setLoadingList(!initial);

        try {
            const params = new URLSearchParams({
                page: String(page),
                pageSize: String(pageSize),
                includeInactive: showInactive ? 'true' : 'false',
            });
            if (debouncedQ) params.set('q', debouncedQ);

            const res = await fetch(`/api/users?${params.toString()}`, { cache: 'no-store', signal: ac.signal });
            const json = await res.json();
            if (json?.success) {
                setData(json.data ?? []);
                setTotal(Number(json.total ?? 0));
                setPages(Math.max(1, Number(json.pages ?? 1)));
            } else {
                setData([]); setTotal(0); setPages(1);
                Toast.fire({ icon: 'error', title: json?.msg ?? 'Error al cargar' });
            }
        } catch (e:any) {
            if (e?.name !== 'AbortError') {
                console.error(e);
                setData([]); setTotal(0); setPages(1);
                Toast.fire({ icon: 'error', title: 'Error cargando usuarios' });
            }
        } finally {
            setInitialLoading(false);
            setLoadingList(false);
            abortRef.current = null;
        }
    }

    const onCreate = () => { setFormInitial(undefined); setOpenForm(true); };
    const onEdit    = (u: User) => { setFormInitial(u); setOpenForm(true); };
    const onSaved   = () => { void fetchData(); };

    const onAskToggleActive = async (u: User) => {
        const action = u.active ? 'Inactivar' : 'Restaurar';
        const result = await Swal.fire({
            title: `${action} usuario`,
            html: u.active ? `¿Inactivar a "<b>${u.nombre}</b>"?` : `¿Restaurar a "<b>${u.nombre}</b>"?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: action,
            cancelButtonText: 'Cancelar',
            focusCancel: true,
            reverseButtons: true,
        });
        if (!result.isConfirmed) return;

        try {
            if (u.active) {
                const res = await fetch(`/api/users/${u.id}`, { method: 'DELETE' });
                await parseResponseOrThrow(res);
                Toast.fire({ icon: 'success', title: `Usuario "${u.nombre}" inactivado` });
            } else {
                const res = await fetch(`/api/users/${u.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ active: true }),
                });
                await parseResponseOrThrow(res);
                Toast.fire({ icon: 'success', title: `Usuario "${u.nombre}" restaurado` });
            }
            void fetchData();
        } catch (e:any) {
            console.error(e);
            Toast.fire({ icon: 'error', title: e?.message ?? 'Error del servidor' });
        }
    };

    const canPrev = page > 1; const canNext = page < pages;
    const from = useMemo(()=> total===0 ? 0 : (page-1)*pageSize + 1, [page, pageSize, total]);
    const to   = useMemo(()=> (page-1)*pageSize + data.length, [page, pageSize, data.length]);

    return (
        <div className={styles.wrap}>
            <div className={styles.controls}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div className={styles.searchBox}>
                        <FiSearch className={styles.searchIcon} />
                        <input
                            className={styles.searchInput}
                            placeholder="Buscar por ID, Nombre o Email"
                            value={q}
                            onChange={(e)=>setQ(e.target.value)}
                            aria-label="Buscar usuarios"
                        />
                    </div>

                    <label className={styles.psizeLabel}>
                        Mostrar
                        <select
                            className={styles.psizeSelect}
                            value={pageSize}
                            onChange={(e)=>{ setPageSize(Number(e.target.value)); setPage(1); }}
                        >
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                        por página
                    </label>

                    <label style={{ display:'flex', alignItems:'center', gap:8, color:'var(--text-muted)', fontSize:14 }}>
                        <input type="checkbox" checked={showInactive} onChange={(e)=>setShowInactive(e.target.checked)} />
                        Mostrar inactivos
                    </label>
                </div>

                <div className={styles.actionButtons}>
                    <span className={styles.counter}>{initialLoading && total===0 ? '—' : `${from}–${to} de ${total}`}</span>
                    <button className={styles.iconButton} title="Actualizar" onClick={()=>void fetchData()} aria-label="Actualizar lista"><FiRefreshCw/></button>
                    <button className={styles.roundButton} title="Nuevo usuario" onClick={onCreate} aria-label="Nuevo usuario"><FiPlus/></button>
                </div>
            </div>

            <div className={styles.tableCard}>
                {initialLoading ? (
                    <table className={styles.table}>
                        <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Activo</th><th/></tr></thead>
                        <tbody>
                        {Array.from({length:10}).map((_,i)=>(
                            <tr key={i}>
                                <td colSpan={5} className={styles.cell}>
                                    <div className={styles.skelRow}>
                                        <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{width:'30%'}}/>
                                        <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{width:'35%'}}/>
                                        <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{width:'10%'}}/>
                                        <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{width:'8%'}}/>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                ) : (
                    <>
                        <table className={styles.table}>
                            <thead>
                            <tr>
                                <th>Nombre</th>
                                <th style={{width:280}}>Email</th>
                                <th style={{width:140}}>Rol</th>
                                <th style={{width:90}}>Activo</th>
                                <th style={{width:260}} aria-hidden/>
                            </tr>
                            </thead>
                            <tbody>
                            {data.length===0 ? (
                                <tr><td colSpan={5} className={styles.emptyRow}>Sin registros</td></tr>
                            ) : data.map(u=>(
                                <tr key={u.id} className={loadingList ? styles.rowDim : undefined}>
                                    <td className={styles.cell}>{u.nombre}</td>
                                    <td className={styles.cell}>{u.email}</td>
                                    <td className={styles.cell}>{u.rol}</td>
                                    <td className={styles.cellCenter}>{u.active ? 'Sí' : 'No'}</td>
                                    <td className={styles.cellActions}>
                                        <button className={styles.smallBtn} title="Editar" onClick={()=>onEdit(u)} aria-label={`Editar ${u.nombre}`}>
                                            <FiEdit2/><span style={{marginLeft:6}}>Editar</span>
                                        </button>
                                        <button className={styles.smallBtn} title="Resetear contraseña" onClick={()=>onEdit(u)}>
                                            <FiKey/><span style={{marginLeft:6}}>Reset pass</span>
                                        </button>
                                        <button
                                            className={styles.smallBtnAlt}
                                            title={u.active ? 'Inactivar' : 'Restaurar'}
                                            onClick={()=>onAskToggleActive(u)}
                                        >
                                            <FiTrash2/><span style={{marginLeft:6}}>{u.active ? 'Inactivar' : 'Restaurar'}</span>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {loadingList && data.length>0 && (
                                <tr>
                                    <td colSpan={5} className={styles.cell}>
                                        <div className={styles.skelRow}>
                                            <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{width:'30%'}}/>
                                            <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{width:'35%'}}/>
                                            <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{width:'10%'}}/>
                                            <div className={`${styles.skelBlock} ${styles.shimmer}`} style={{width:'8%'}}/>
                                        </div>
                                    </td>
                                </tr>
                            )}
                            </tbody>
                        </table>

                        <div className={styles.pager}>
                            <button className={styles.pagerBtn} onClick={()=>setPage(1)} disabled={!canPrev}>«</button>
                            <button className={styles.pagerBtn} onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={!canPrev}>‹</button>
                            <span className={styles.pagerStatus}>
                Página
                <input
                    className={styles.pagerInput}
                    value={page}
                    onChange={(e)=>{ const v = Number(e.target.value.replace(/\D/g,'')) || 1; setPage(Math.min(Math.max(1,v), pages)); }}
                    onBlur={()=>setPage(p=>Math.min(Math.max(1,p), pages))}
                />
                de {pages}
              </span>
                            <button className={styles.pagerBtn} onClick={()=>setPage(p=>Math.min(pages,p+1))} disabled={!canNext}>›</button>
                            <button className={styles.pagerBtn} onClick={()=>setPage(pages)} disabled={!canNext}>»</button>
                        </div>
                    </>
                )}
            </div>

            <UserFormModal
                open={openForm}
                initial={formInitial}
                onClose={()=>setOpenForm(false)}
                onSaved={()=>void fetchData()}
            />
        </div>
    );
}
