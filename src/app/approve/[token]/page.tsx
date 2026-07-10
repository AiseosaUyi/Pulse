// Mobile approval page (Part 3 of the /api/v1 + MCP build spec). Public —
// no session, reached via a signed one-time link delivered by email or
// WhatsApp. Auth is entirely the JWT in the URL; see
// src/lib/supabase/middleware.ts's PUBLIC_PATHS for the proxy exemption.

import { verifyApprovalToken } from "@/lib/approvals/token";
import { getApprovalContext } from "@/lib/services/approvals";
import { createAdminClient } from "@/lib/supabase/admin";
import { PublicPageShell } from "@/components/layout/PublicPageShell";
import { ApprovalStateCard } from "./ApprovalStateCard";
import { ApprovalCard } from "./ApprovalCard";

export const dynamic = "force-dynamic";

export default async function ApprovePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const verified = await verifyApprovalToken(token);

  if (!verified.ok) {
    return (
      <PublicPageShell>
        <ApprovalStateCard
          kind={verified.reason === "expired" ? "expired" : "invalid"}
        />
      </PublicPageShell>
    );
  }

  const admin = createAdminClient();
  const ctx = await getApprovalContext(admin, verified.requestId);

  if (ctx.state === "not_found") {
    return (
      <PublicPageShell>
        <ApprovalStateCard kind="invalid" />
      </PublicPageShell>
    );
  }

  if (ctx.state === "expired") {
    return (
      <PublicPageShell>
        <ApprovalStateCard kind="expired" />
      </PublicPageShell>
    );
  }

  if (ctx.state === "already_actioned") {
    return (
      <PublicPageShell>
        <ApprovalStateCard
          kind={ctx.request.status === "approved" ? "already_approved" : "already_rejected"}
          decidedAt={ctx.request.decidedAt}
          target={ctx.target}
        />
      </PublicPageShell>
    );
  }

  return (
    <PublicPageShell className="pb-24">
      <ApprovalCard token={token} target={ctx.target} />
    </PublicPageShell>
  );
}
