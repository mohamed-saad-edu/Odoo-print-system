"use client";
import { useEffect, useState } from "react";
import { Database, Search, Table2, ArrowLeft, ArrowRight, ShieldCheck, RefreshCw } from "lucide-react";
import { Button, Card, PageHeader, ErrorState } from "../../../components/ui";
import { fetchWithTimeout } from "../../../lib/fetch-timeout";
import { useI18n } from "../../../i18n/react";

type TableMeta={name:string;columns:string[];primaryKey:string|null};
type Result={tables:TableMeta[];selected:string|null;columns:string[];rows:Record<string,unknown>[];hasMore:boolean};
export default function PlatformDatabasePage(){
 const {locale}=useI18n(),ar=locale==="ar";
 const [table,setTable]=useState(""),[input,setInput]=useState(""),[search,setSearch]=useState(""),[offset,setOffset]=useState(0);
 const [data,setData]=useState<Result|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true),[version,setVersion]=useState(0);
 useEffect(()=>{
   const ctl=new AbortController();let active=true;
   const p=new URLSearchParams();if(table)p.set("table",table);if(search)p.set("id",search);p.set("offset",String(offset));
   setLoading(true);
   fetchWithTimeout("/api/platform/database?"+p.toString(),{signal:ctl.signal,cache:"no-store"})
      .then(async r=>{const x=await r.json();if(!r.ok)throw Error(x.error||"Database unavailable");return x as Result})
      .then(x=>{if(active){setData(x);setError("");}}).catch(e=>{if(active)setError(String(e));})
      .finally(()=>{if(active)setLoading(false)});
   return()=>{active=false;ctl.abort()};
 },[table,search,offset,version]);
 const tables=data?.tables??[];
 return <div className="space-y-5 pb-10">
 <PageHeader title={ar?"مستكشف قاعدة البيانات":"Database Explorer"} eyebrow="Platform / Data"
  icon={<Database className="h-5 w-5"/>}
  description={ar?"استعرض الجداول وابحث بالمعرّف. القراءة فقط، والبيانات الحساسة مخفية.":"Explore tables and look up records by ID. Read-only with sensitive fields excluded."}
  actions={<Button variant="secondary" size="sm" onClick={()=>setVersion(n=>n+1)} icon={<RefreshCw className="h-4 w-4"/>}>{ar?"تحديث":"Refresh"}</Button>}/>
 <div className="flex items-center gap-2 rounded-xl border border-edge bg-surface p-4 text-sm text-ink-3"><ShieldCheck className="h-5 w-5 shrink-0 text-ok"/>{ar?"مالك المنصة فقط · نتائج محدودة · بدون استعلامات SQL أو أسرار":"Platform Owner only · bounded records · no arbitrary SQL or credential secrets"}</div>
 {error&&<ErrorState title={ar?"تعذر قراءة البيانات":"Database read failed"} message={error} retry={()=>setVersion(x=>x+1)}/>}
 {!table&&<section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{tables.map(t=><button key={t.name} type="button" onClick={()=>{setTable(t.name);setOffset(0);setSearch("");setInput("")}} className="rounded-xl border border-edge bg-surface p-5 text-start transition-colors hover:border-brand/50 focus-visible:outline-2 focus-visible:outline-brand"><div className="flex items-center gap-3"><span className="rounded-lg bg-surface-2 p-3"><Table2 className="h-5 w-5 text-brand"/></span><div className="min-w-0"><div className="break-all text-sm font-semibold text-ink">{t.name}</div><div className="mt-1 text-xs text-ink-3">{t.columns.length} {ar?"عمود متاح":"visible columns"}</div></div></div></button>)}</section>}
 {table&&<Card className="overflow-hidden p-5"><div className="mb-4 flex flex-wrap items-center gap-3"><Button size="sm" variant="secondary" onClick={()=>{setTable("");setSearch("");setInput("");setOffset(0)}} icon={<ArrowLeft className="h-4 w-4"/>}>{ar?"كل الجداول":"All tables"}</Button><h2 className="break-all text-base font-semibold text-ink">{table}</h2></div>
 <form onSubmit={e=>{e.preventDefault();setSearch(input.trim());setOffset(0)}} className="mb-4 flex flex-wrap gap-2"><label className="min-w-[160px] flex-1"><span className="sr-only">{ar?"معرّف السجل":"Record ID"}</span><input maxLength={150} value={input} onChange={e=>setInput(e.target.value)} placeholder={ar?"ابحث بمعرف السجل ID":"Find by record ID"} className="h-11 w-full rounded-lg border border-edge bg-surface-2 px-3 text-sm text-ink"/></label><Button submit icon={<Search className="h-4 w-4"/>}>{ar?"بحث":"Search"}</Button><Button variant="secondary" onClick={()=>{setInput("");setSearch("");setOffset(0)}}>{ar?"مسح البحث":"Clear"}</Button></form>
 <div className="overflow-x-auto"><table className="data-table min-w-[720px]"><thead><tr>{(data?.columns??[]).map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{(data?.rows??[]).map((r,i)=><tr key={i}>{(data?.columns??[]).map(c=><td key={c} className="max-w-72 break-all font-mono text-xs">{r[c]===null?"—":String(r[c]??"")}</td>)}</tr>)}</tbody></table></div>
 {!loading&&data?.rows.length===0&&<p className="p-5 text-sm text-ink-3">{ar?"لا توجد سجلات":"No matching records"}</p>}
 <div className="mt-4 flex items-center justify-between text-xs text-ink-3"><span>{loading?(ar?"جارٍ التحميل":"Loading"):data?.rows.length??0} {ar?"سجل":"records"}</span><div className="flex gap-2"><Button variant="secondary" size="xs" disabled={offset===0||loading} onClick={()=>setOffset(n=>Math.max(0,n-25))}><ArrowLeft className="h-4 w-4"/></Button><Button size="xs" variant="secondary" disabled={!data?.hasMore||loading} onClick={()=>setOffset(n=>n+25)}><ArrowRight className="h-4 w-4"/></Button></div></div>
 </Card>}
 </div>;
}
