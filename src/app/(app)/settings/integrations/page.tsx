import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { listIntegrations } from "@/lib/services/integrations";
import { IntegrationsClient } from "./client";

export default async function IntegrationsSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/signup?step=company");

  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 md:py-12">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-foreground mb-6"
        >
          <ArrowLeft size={14} />
          Back to settings
        </Link>
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          <h1 className="text-xl font-bold text-foreground">Owners and admins only</h1>
          <p className="text-sm text-text-muted mt-2 max-w-md mx-auto">
            Publishing credentials are managed by your workspace owner.
          </p>
        </div>
      </div>
    );
  }

  const integrations = await listIntegrations(tenant.slug);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 md:py-12">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-foreground mb-6"
      >
        <ArrowLeft size={14} />
        Back to settings
      </Link>
      <header className="mb-8">
        <h1
          className="text-2_5xl text-gray-1100 tracking-tight"
          style={{ fontFamily: "'Satoshi-900', var(--font-sans)" }}
        >
          Integrations
        </h1>
        <p className="text-sm text-gray-1000 mt-2">
          Connect the accounts Pulse publishes to. All tokens stay server-side —
          the browser never sees them.
        </p>
      </header>
      <IntegrationsClient tenantSlug={tenant.slug} initial={integrations} />
    </div>
  );
}
