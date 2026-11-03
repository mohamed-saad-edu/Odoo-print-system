import { Printer } from "lucide-react";
import DashboardPageContent from "../dashboard/dashboard-page-content";

export const dynamic = "force-dynamic";

// WP8: Printers as a first-class sidebar page (was a hash view inside /dashboard).
// Same server auth gate and fleet loader as /dashboard, via the shared
// DashboardPageContent; the client view is locked to "printers", so the
// add-printer guidance and the sharing/agent states live here, not
// buried inside the Dashboard home view.
export default async function PrintersPage() {
  return (
    <DashboardPageContent
      view="printers"
      locked
      titleKey="desktop.nav.printers"
      descriptionKey="dashboard.page.printersDescription"
      headerIcon={<Printer className="h-4 w-4" />}
    />
  );
}
