import { Server } from "lucide-react";
import DashboardPageContent from "../dashboard/dashboard-page-content";

export const dynamic = "force-dynamic";

// WP8: Agents as a first-class sidebar page (was a hash view inside /dashboard).
// Same server auth gate and fleet loader as /dashboard, via the shared
// DashboardPageContent; the client view is locked to "agents".
export default async function AgentsPage() {
  return (
    <DashboardPageContent
      view="agents"
      locked
      titleKey="dashboard.tab.agents"
      descriptionKey="dashboard.page.agentsDescription"
      headerIcon={<Server className="h-4 w-4" />}
    />
  );
}
