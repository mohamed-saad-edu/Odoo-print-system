import { Layers } from "lucide-react";
import DashboardPageContent from "../dashboard/dashboard-page-content";

export const dynamic = "force-dynamic";

// WP8: Jobs as a first-class sidebar page (was a hash view inside /dashboard), completing
// the Operations group. Same server auth gate and fleet loader as
// /dashboard, via the shared DashboardPageContent; the client view is
// locked to "jobs".
export default async function JobsPage() {
  return (
    <DashboardPageContent
      view="jobs"
      locked
      titleKey="nav.jobs"
      descriptionKey="dashboard.page.jobsDescription"
      headerIcon={<Layers className="h-4 w-4" />}
    />
  );
}
