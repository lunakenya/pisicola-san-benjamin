// src/components/EditRequestForm.tsx
'use client';

import React, { useEffect, useState } from 'react';
import styles from '@/app/edit-requests/edit-requests.module.css';
import Swal from 'sweetalert2';

export default function EditRequestForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (r:any) => void; }) {
    const [tabla, setTabla] = useState('bajas');
    const [registroId, setRegistroId] = useState('');
    const [motivo, setMotivo] = useState('');
    const [loading, setLoading] = useState(false);
    useEffect(()=> { if(open){ setTabla('bajas'); setRegistroId(''); setMotivo(''); } }, [open]);

    if(!open) return null;

    async function submit(e?: React.FormEvent) {
        e?.preventDefault();
        if(!registroId || !motivo.trim()) { Swal.fire('Error','Rellenar registro y motivo','error'); return; }
        setLoading(true);
        try {
            const res = await fetch('/api/edit-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tabla, registro_id: Number(registroId), motivo: motivo.trim() }),
            });
            const json = await res.json();
            if(json?.success) {
                onSaved(json.data);
            } else {
                Swal.fire('Error', json?.msg || 'Error creando solicitud','error');
            }
        } catch(e) {
            console.error(e);
            Swal.fire('Error','Error del servidor','error');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modalOverlay" role="dialog" aria-modal="true" style={{
            position:'fixed',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.3)'
        }}>
            <form className="modal" onSubmit={submit} style={{ background:'#fff', padding:20, borderRadius:8, minWidth:420 }}>
                <h3 style={{marginTop:0}}>Nueva solicitud de edición</h3>

                <label style={{display:'block',marginBottom:8}}>
                    Tabla
                    <select value={tabla} onChange={(e)=>setTabla(e.target.value)} style={{display:'block',padding:8,width:'100%'}}>
                        <option value="bajas">Bajas</option>
                        <option value="alimentos">Alimentos</option>
                        <option value="cosechas">Cosechas</option>
                    </select>
                </label>

                <label style={{display:'block',marginBottom:8}}>
                    N° de registro
                    <input value={registroId} onChange={(e)=>setRegistroId(e.target.value.replace(/\D/g,''))} className="input" style={{display:'block',padding:8,width:'100%'}} />
                </label>

                <label style={{display:'block',marginBottom:8}}>
                    Motivo
                    <textarea value={motivo} onChange={(e)=>setMotivo(e.target.value)} rows={4} style={{display:'block',padding:8,width:'100%'}} />
                </label>

                <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:12}}>
                    <button type="button" onClick={onClose} style={{padding:'8px 12px'}}>Cancelar</button>
                    <button type="submit" style={{background:'#2fa360', color:'#fff', padding:'8px 12px'}} disabled={loading}>{loading ? 'Guardando...' : 'Solicitar'}</button>
                </div>
            </form>
        </div>
    );
}
