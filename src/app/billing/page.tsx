import { redirect } from "next/navigation";
/** Commercial billing is exclusively administered in Platform Admin. */
export default function Page(_props?: { searchParams?: Promise<unknown> }) {
  redirect("/dashboard");
  return null;
}
