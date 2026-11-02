"use client";
import { useState } from "react";
import { Button } from "../ui";
import { adminJson,controlClass } from "./ManualAdmin";
import { useI18n } from "../../i18n/react";
import type { MessageKey } from "../../i18n/messages/en";
/** Existing audited lifecycle API retains the tenant dispatch fence. */
export function WorkspaceLifecycle({tenantId,lifecycle,updatedAt,onSaved}:{tenantId:string;lifecycle:string;updatedAt:string;onSaved:()=>void}){
 const {t}=useI18n(),[key,setKey]=useState(''),[open,setOpen]=useState(false),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(lifecycle==='deleted')return null;
 const action=lifecycle==='suspended'?'reactivate':'suspend';
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);try{await adminJson(`/api/platform/tenants/${encodeURIComponent(tenantId)}/${action}`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({reason,expectedLifecycle:lifecycle,expectedUpdatedAt:updatedAt})});setOpen(false);onSaved();}catch{setError(t("v4.admin.saveError"));}finally{setBusy(false);}}
 return <div className="mt-5 border-t border-edge pt-4">{error&&<p role="alert">{error}</p>}{open?<form onSubmit={submit} className="space-y-3"><p>{t(`v4.admin.${action==='suspend'?'suspendWorkspace':'reactivateWorkspace'}` as MessageKey)}</p><label className="block text-sm">{t("v4.admin.reason")}<textarea className={controlClass} maxLength={500} required value={reason} onChange={e=>setReason(e.target.value)}/></label><Button disabled={busy} loading={busy} type="submit">{t("v4.admin.confirm")}</Button></form>:<Button variant="secondary" onClick={()=>{setKey(crypto.randomUUID());setOpen(true);}}>{t(`v4.admin.${action==='suspend'?'suspendWorkspace':'reactivateWorkspace'}` as MessageKey)}</Button>}</div>;
}
