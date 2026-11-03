import { redirect } from "next/navigation";
import { Activity } from "lucide-react";
import DashboardPageContent from "./dashboard-page-content";

export const dynamic = "force-dynamic";

// WP8: /dashboard is Home now. A fleet view in the query string is an old
// bookmark for a page that has its own route — redirect server-side so
// the destination's own auth gate (and its login `next` parameter) apply
// instead of rendering the old view inside Home.
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const requestedView = (await searchParams).view;
  if (requestedView === "agents" || requestedView === "printers" || requestedView === "jobs") {
    redirect(`/${requestedView}`);
  }
  return (
    <DashboardPageContent
      view="home"
      locked={false}
      titleKey="v4.experience.home"
      headerIcon={<Activity className="h-4 w-4" />}
      showCleanup
    />
  );
}
