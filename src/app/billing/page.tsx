import { redirect } from "next/navigation";
/** Commercial plan management requires a separately authenticated Platform Owner. */
export default function Page(_props: { searchParams?: Promise<unknown> }) {
  redirect("/platform/subscriptions");
  return null;
}
