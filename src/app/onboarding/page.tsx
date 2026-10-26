import { redirect } from "next/navigation";
/** No workspace member can request or edit commercial subscriptions. */
export default function Page() {
  redirect("/dashboard");
  return null;
}
