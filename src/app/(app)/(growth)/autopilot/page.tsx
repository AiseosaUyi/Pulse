import Link from "next/link";
import { requireTenantRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailbox } from "@/lib/outreach-autopilot/mailbox";
import { listReviewDrafts } from "@/lib/outreach-autopilot/review";
import { startOfLocalDay } from "@/lib/outreach-autopilot/schedule";
import { DraftReview } from "@/components/autopilot/DraftReview";
import { AutopilotToggle, FindEmailsButton, UnapproveButton } from "./client";

export const dynamic = "force-dynamic";
// "Find emails now" runs a capped pass (about 90s) in this page's function.
export const maxDuration = 120;

const KIND: Record<string, string> = {
  cold_open: "First email",
  follow_up_1: "Follow-up 1",
  follow_up_2: "Follow-up 2",
  reply: "Reply",
};

export default async function AutopilotPage() {
  // Support users are limited to Conversations; this page shows prospect emails.
  const tenant = await requireTenantRole(["owner", "admin", "member"]);
  const canManage = tenant.role === "owner" || tenant.role === "admin";
  const admin = createAdminClient();
  const slug = tenant.slug;

  const { data: t } = await admin.from("tenants").select("timezone").eq("slug", slug).maybeSingle();
  const tz = (t?.timezone as string) || "Africa/Lagos";
  const todayStart = startOfLocalDay(new Date(), tz).toISOString();

  const [mailbox, drafts, queued, recent, sentTodayRes] = await Promise.all([
    getMailbox(admin, slug),
    listReviewDrafts(admin, slug),
    admin
      .from("outbound_dms")
      .select("id, subject, to_email, kind, scheduled_send_at, error")
      .eq("tenant_slug", slug)
      .eq("send_via", "mailbox")
      .in("status", ["approved", "sending"])
      .order("scheduled_send_at", { ascending: true })
      .limit(50),
    admin
      .from("outbound_dms")
      .select("id, subject, to_email, kind, status, sent_at, error, updated_at")
      .eq("tenant_slug", slug)
      .eq("send_via", "mailbox")
      .in("status", ["sent", "replied", "failed", "cancelled"])
      .order("updated_at", { ascending: false })
      .limit(30),
    admin
      .from("outbound_dms")
      .select("id", { count: "exact", head: true })
      .eq("tenant_slug", slug)
      .eq("send_via", "mailbox")
      .gte("sent_at", todayStart),
  ]);

  const sentToday = sentTodayRes.count ?? 0;

  return (
    <div className="max-w-[880px] space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl text-gray-1100 dark:text-foreground tracking-tight font-semibold">Email autopilot</h1>
        <p className="text-sm text-gray-1000 dark:text-text-muted mt-1.5">
          Pulse drafts first emails and follow-ups, emails you once a day to approve them, sends what you approve from
          your own mailbox, and stops when someone replies.
        </p>
      </header>

      <section className="bg-card border border-border rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        {mailbox ? (
          <div className="text-sm space-y-1">
            <p className="text-gray-1100 dark:text-foreground">
              Sending from <strong>{mailbox.fromEmail}</strong> · {sentToday} of {mailbox.dailyCap} sent today ·
              window {mailbox.sendWindowStart}:00 to {mailbox.sendWindowEnd}:00
            </p>
            <p className="text-gray-1000 dark:text-text-muted">
              Approval email to {mailbox.approverEmail} at {mailbox.digestHour}:00.{" "}
              {mailbox.imapCheckedAt ? `Replies last checked ${new Date(mailbox.imapCheckedAt).toLocaleString()}.` : ""}
            </p>
            {mailbox.lastError && <p className="text-red-600">Last problem: {mailbox.lastError}</p>}
          </div>
        ) : (
          <p className="text-sm text-gray-1000 dark:text-text-muted">
            No mailbox yet.{" "}
            <Link href="/settings/outreach" className="text-primary-500 underline">
              Set up the sending mailbox
            </Link>{" "}
            to turn Autopilot on.
          </p>
        )}
        <div className="flex items-center gap-3">
          {mailbox && canManage && <AutopilotToggle enabled={mailbox.enabled} />}
          <Link href="/settings/outreach" className="text-sm text-primary-500 underline">
            Settings and copy
          </Link>
        </div>
      </section>

      {canManage && (
        <section className="bg-card border border-border rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-gray-1000 dark:text-text-muted max-w-[560px]">
            Each day Pulse looks for an email on each lead&apos;s own website and keeps it only if it checks out. It
            never guesses an address.
          </p>
          <FindEmailsButton />
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-1100 dark:text-foreground">Waiting for your approval</h2>
        {canManage ? (
          <DraftReview drafts={drafts} mode={{ kind: "app" }} />
        ) : (
          <p className="text-sm text-gray-1000 dark:text-text-muted">{drafts.length} drafts waiting. An owner or admin approves them.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-1100 dark:text-foreground">Approved, going out next</h2>
        {(queued.data ?? []).length === 0 ? (
          <p className="text-sm text-gray-1000 dark:text-text-muted">Nothing queued.</p>
        ) : (
          <ul className="bg-card border border-border rounded-2xl divide-y divide-border">
            {(queued.data ?? []).map((q) => (
              <li key={q.id as string} className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="text-gray-1100 dark:text-foreground">{(q.subject as string) || "(no subject)"}</p>
                  <p className="text-xs text-gray-1000 dark:text-text-muted">
                    {KIND[q.kind as string] ?? q.kind} to {q.to_email as string}
                    {q.error ? ` · retrying: ${q.error as string}` : ""}
                  </p>
                </div>
                {canManage && <UnapproveButton dmId={q.id as string} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-1100 dark:text-foreground">Recent</h2>
        {(recent.data ?? []).length === 0 ? (
          <p className="text-sm text-gray-1000 dark:text-text-muted">Nothing sent yet.</p>
        ) : (
          <ul className="bg-card border border-border rounded-2xl divide-y divide-border">
            {(recent.data ?? []).map((r) => (
              <li key={r.id as string} className="px-5 py-3 text-sm">
                <p className="text-gray-1100 dark:text-foreground">
                  {(r.subject as string) || "(no subject)"}{" "}
                  <span className="text-xs text-gray-1000 dark:text-text-muted">· {r.status as string}</span>
                </p>
                <p className="text-xs text-gray-1000 dark:text-text-muted">
                  {KIND[r.kind as string] ?? r.kind} to {r.to_email as string}
                  {r.sent_at ? ` · ${new Date(r.sent_at as string).toLocaleString()}` : ""}
                  {r.error ? ` · ${r.error as string}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
