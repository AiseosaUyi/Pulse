// Opened from the daily approval email. Public (under /approve, see
// PUBLIC_PATHS): the signed link is the only credential, it expires in 72h
// and only covers the drafts listed in that one email. Opening the page
// changes nothing; only the buttons (server actions) do.

import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { PublicPageShell } from "@/components/layout/PublicPageShell";
import { resolveDigest } from "@/lib/outreach-autopilot/digest";
import { listReviewDrafts } from "@/lib/outreach-autopilot/review";
import { DraftReview } from "@/components/autopilot/DraftReview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Approve outreach", robots: { index: false, follow: false } };

export default async function OutreachApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const d = await resolveDigest(admin, token);

  if (!d.ok) {
    return (
      <PublicPageShell>
        <div className="bg-card border border-border rounded-2xl p-6 text-center">
          <h1 className="text-lg font-semibold text-gray-1100 dark:text-foreground">
            {d.reason === "expired" ? "This link has expired" : "This link is not valid"}
          </h1>
          <p className="mt-2 text-sm text-gray-1000 dark:text-text-muted">
            Open Autopilot in Pulse to review what is waiting.
          </p>
        </div>
      </PublicPageShell>
    );
  }

  const [drafts, tenant] = await Promise.all([
    listReviewDrafts(admin, d.digest.tenantSlug, { ids: d.digest.dmIds }),
    admin.from("tenants").select("name").eq("slug", d.digest.tenantSlug).maybeSingle(),
  ]);

  return (
    <PublicPageShell className="max-w-[720px] pb-16">
      <h1 className="text-xl font-semibold text-gray-1100 dark:text-foreground mb-1">
        {(tenant.data?.name as string) ?? d.digest.tenantSlug}: emails to approve
      </h1>
      <p className="text-sm text-gray-1000 dark:text-text-muted mb-5">
        Edit anything you like. Approved emails go out from your mailbox inside your send window.
      </p>
      <DraftReview drafts={drafts} mode={{ kind: "token", token }} />
    </PublicPageShell>
  );
}
