"use client";
import { useState } from "react";
import { Button } from "../ui";
import { adminJson,controlClass,useAdminText } from "./ManualAdmin";
/** Existing audited lifecycle API retains the tenant dispatch fence. */
export function WorkspaceLifecycle({tenantId,lifecycle,updatedAt,onSaved}:{tenantId:string;lifecycle:string;updatedAt:string;onSaved:()=>void}){
 const {a}=useAdminText(),[key,setKey]=useState(''),[open,setOpen]=useState(false),[reason,setReason]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(lifecycle==='deleted')return null;
 const action=lifecycle==='suspended'?'reactivate':'suspend';
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);const proof=password;setPassword('');try{await adminJson('/api/platform/auth/reauth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:proof})});await adminJson(`/api/platform/tenants/${encodeURIComponent(tenantId)}/${action}`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({reason,expectedLifecycle:lifecycle,expectedUpdatedAt:updatedAt})});setOpen(false);onSaved();}catch{setError(a('saveError'));}finally{setBusy(false);}}
 return <div className="mt-5 border-t border-edge pt-4">{error&&<p role="alert">{error}</p>}{open?<form onSubmit={submit} className="space-y-3"><p>{a(action==='suspend'?'suspendWorkspace':'reactivateWorkspace')}</p><label className="block text-sm">{a('reason')}<textarea className={controlClass} maxLength={500} required value={reason} onChange={e=>setReason(e.target.value)}/></label><label className="block text-sm">{a('password')}<input className={controlClass} type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><Button disabled={busy} loading={busy} type="submit">{a('confirm')}</Button></form>:<Button variant="secondary" onClick={()=>{setKey(crypto.randomUUID());setOpen(true);}}>{a(action==='suspend'?'suspendWorkspace':'reactivateWorkspace')}</Button>}</div>;
}
