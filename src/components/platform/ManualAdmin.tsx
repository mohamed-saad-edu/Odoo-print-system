"use client";
import { formatManualCalendarDate } from "../../lib/manual-calendar-date";
import { useCallback } from "react";
import { useI18n } from "../../i18n/react";
import type { MessageKey } from "../../i18n/messages/en";
import { v4AdminEn } from "../../i18n/messages/v4-admin";
import { fetchWithTimeout } from "../../lib/fetch-timeout";
export type AdminKey = keyof typeof v4AdminEn;
export function useAdminText(){const i18n=useI18n();const {t}=i18n;const a=useCallback((key:string)=>t((`v4.admin.${key}`) as MessageKey),[t]);const formatDate=useCallback((value:Date|string|number|null|undefined)=>formatManualCalendarDate(value,i18n.locale)??t("common.notAvailable"),[i18n.locale,t]);return {...i18n,a,formatDate};}
export async function adminJson(url:string,options?:RequestInit){const res=await fetchWithTimeout(url,{credentials:'same-origin',cache:'no-store',...options});const data=await res.json();if(!res.ok)throw new Error(data.code??'MANUAL_SUBSCRIPTION_UNAVAILABLE');return data;}
export const controlClass='w-full rounded-lg border border-edge bg-surface px-3 py-2.5 text-ink focus:outline-none focus:ring-2 focus:ring-brand/40';
export function AdminMetric({label,value,detail}:{label:string;value:React.ReactNode;detail?:React.ReactNode}){return <div className="rounded-xl border border-edge-subtle bg-surface p-5"><p className="text-sm text-ink-3">{label}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>{detail&&<div className="mt-2 text-sm text-ink-3">{detail}</div>}</div>;}
export function AdminStatus({status}:{status:string}){const {a}=useAdminText();return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${status==='active'||status==='approved'?'bg-ok/10 text-ok':status==='suspended'||status==='expired'||status==='rejected'?'bg-warn/10 text-warn':'bg-surface-2 text-ink-2'}`}>{a(status)}</span>;}
