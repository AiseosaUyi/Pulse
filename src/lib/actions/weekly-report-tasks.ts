"use server";

// Turn the weekly report's recommended actions into real tasks, so the report
// drives the week's plan instead of being text nobody acts on. Tasks are
// tagged "weekly-report" and matched by title, so pressing twice never makes
// a duplicate.

import { revalidatePath } from "next/cache";
import { getCurrentTenant, getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantTimezone } from "@/lib/services/tasks";
import { getTenantToday } from "@/lib/tasks/date-utils";
import { createTaskAction } from "@/lib/actions/tasks";
import { sendBrevoEmail, getAppBaseUrl } from "@/lib/integrations/brevo";
import { weeklyDigestHtml } from "@/lib/email/weekly-digest-email";
import type { RecommendedAction } from "@/lib/types/insights";

const TAG = "weekly-report";
/** Days to do it in, by priority. */
const DUE_IN_DAYS: Record<number, number> = { 1: 2, 2: 4, 3: 7 };
const PRIORITY: Record<number, "urgent" | "high" | "normal"> = { 1: "high", 2: "normal", 3: "normal" };

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadReport(digestId: string) {
  const tenant = await getCurrentTenant();
  if (!tenant || tenant.role === "support") return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("weekly_digests")
    .select("id, week_of, strategic_brief, narrative, recommended_actions")
    .eq("tenant_slug", tenant.slug)
    .eq("id", digestId)
    .maybeSingle();
  if (!data) return null;
  return { tenant, admin, digest: data, actions: (data.recommended_actions as RecommendedAction[] | null) ?? [] };
}

/** Titles of this report's actions that already have a live task. */
export async function reportActionsWithTasks(digestId: string): Promise<string[]> {
  const r = await loadReport(digestId);
  if (!r || !r.actions.length) return [];
  const { data } = await r.admin
    .from("tasks")
    .select("title")
    .eq("tenant_slug", r.tenant.slug)
    .contains("tags", [TAG])
    .neq("status", "archived")
    .in("title", r.actions.map((a) => a.action));
  return (data ?? []).map((t) => t.title as string);
}

export async function makeTaskFromReportAction(input: {
  digestId: string;
  /** Index into the report's recommended_actions as stored. */
  index: number;
  ownerPersonId: string | null;
}): Promise<{ success: true; existed: boolean } | { success: false; error: string }> {
  const r = await loadReport(input.digestId);
  if (!r) return { success: false, error: "Report not found" };
  const a = r.actions[input.index];
  if (!a) return { success: false, error: "That action is no longer in the report" };

  const done = await reportActionsWithTasks(input.digestId);
  if (done.includes(a.action)) return { success: true, existed: true };

  const tz = await getTenantTimezone(r.admin, r.tenant.slug);
  const today = getTenantToday(tz);
  const res = await createTaskAction({
    title: a.action,
    description: `${a.rationale}\n\nFrom the weekly report, week of ${r.digest.week_of}.`,
    ownerPersonId: input.ownerPersonId,
    priority: PRIORITY[a.priority] ?? "normal",
    kind: "one_off",
    startDate: today,
    dueDate: addDays(today, DUE_IN_DAYS[a.priority] ?? 7),
    proofRequired: "none",
    tags: [TAG],
    checklist: [],
  });
  if (!res.success) return { success: false, error: res.error ?? "Could not create the task" };
  revalidatePath("/weekly-report");
  return { success: true, existed: false };
}

/** Email this report to the person viewing it, now. */
export async function emailReportToMeAction(digestId: string): Promise<{ success: boolean; error?: string }> {
  const r = await loadReport(digestId);
  if (!r) return { success: false, error: "Report not found" };
  const user = await getCurrentUser();
  if (!user?.email) return { success: false, error: "No email on your account" };

  const html = weeklyDigestHtml({
    tenantName: r.tenant.name,
    weekOf: r.digest.week_of as string,
    narrative: (r.digest.narrative as string | null) ?? null,
    strategicBrief: (r.digest.strategic_brief as string | null) ?? null,
    actions: r.actions,
    reportUrl: `${getAppBaseUrl()}/weekly-report`,
    wins: [],
    drags: [],
    nextWeekFocus: [],
    aiCostUsd: 0,
  });
  const sent = await sendBrevoEmail({
    to: { email: user.email },
    subject: `${r.tenant.name}: your weekly report, week of ${r.digest.week_of}`,
    htmlContent: html,
  });
  if (!sent.ok) return { success: false, error: sent.error };
  return { success: true };
}
