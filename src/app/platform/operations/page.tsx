"use client";
import Link from "next/link";
import { Card,PageHeader } from "../../../components/ui";
import { useAdminText } from "../../../components/platform/ManualAdmin";
export default function Operations(){const {a}=useAdminText();return <div className="space-y-6"><PageHeader variant="inline" title={a('operations')} /><div className="grid gap-4 sm:grid-cols-3">{[['fleet','devices'],['jobs','jobs'],['integrations','integrations']].map(([path,label])=><Link key={path} href={`/platform/${path}`}><Card className="p-6 text-lg font-semibold">{a(label)}</Card></Link>)}</div></div>;}
