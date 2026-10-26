import { redirect } from "next/navigation";
/** Billing and subscription management is available only in Platform Admin. */
export default function Page() { redirect("/dashboard"); }
