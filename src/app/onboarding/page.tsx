import { redirect } from "next/navigation";

/** Legacy setup links resolve inside the customer workspace, never Platform Admin. */
export default function Page() {
  redirect("/billing");
}
