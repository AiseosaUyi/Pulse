"use server";

// Outreach autopilot actions.
//   *FromDigest: authorised by the signed link in the approval email, limited
//     to that tenant and to the drafts listed in that email.
//   everything else: a signed-in owner/admin of the current tenant.
// All writes use the admin client after that check (outreach tables are
// service-role-only for writes, migrations 115/116).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTenant, getCurrentUser } from "@/lib/auth";
import { resolveDigest } from "@/lib/outreach-autopilot/digest";
import {
  decideDraft,
  editDraft,
  unapproveDraft,
  type DecideResult,
} from "@/lib/outreach-autopilot/review";
import {
  createSmtpTransport,
  formatFrom,
  getMailboxWithSecret,
  mailboxInputSchema,
  saveMailbox,
  type MailboxInput,
} from "@/lib/outreach-autopilot/mailbox";
import { rebuildBannedRegex, textToHtml } from "@/lib/outreach-autopilot/templates";

const decideSchema = z.object({
  dmId: z.string().uuid(),
  action: z.enum(["approve", "skip"]),
  subject: z.string().optional(),
  body: z.string().optional(),
});
const editSchema = z.object({ dmId: z.string().uuid(), subject: z.string(), body: z.string() });

async function requireManager(): Promise<{ tenantSlug: string; userId: string } | { error: string }> {
  const [tenant, user] = await Promise.all([getCurrentTenant(), getCurrentUser()]);
  if (!tenant || !user) return { error: "Sign in again" };
  if (tenant.role !== "owner" && tenant.role !== "admin") return { error: "Only owners and admins can do this" };
  return { tenantSlug: tenant.slug, userId: user.id };
}

// ── Approval-email link ─────────────────────────────────────────────────────

export async function decideFromDigest(token: string, input: unknown): Promise<DecideResult> {
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const admin = createAdminClient();
  const d = await resolveDigest(admin, token);
  if (!d.ok) return { ok: false, error: d.reason === "expired" ? "This link has expired" : "This link is not valid" };
  return decideDraft(admin, d.digest.tenantSlug, parsed.data, {
    via: "email_digest",
    userId: null,
    allowedIds: d.digest.dmIds,
  });
}

export async function editFromDigest(token: string, input: unknown): Promise<DecideResult> {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const admin = createAdminClient();
  const d = await resolveDigest(admin, token);
  if (!d.ok) return { ok: false, error: d.reason === "expired" ? "This link has expired" : "This link is not valid" };
  return editDraft(admin, d.digest.tenantSlug, parsed.data, d.digest.dmIds);
}

// ── In-app ──────────────────────────────────────────────────────────────────

export async function decideInApp(input: unknown): Promise<DecideResult> {
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const who = await requireManager();
  if ("error" in who) return { ok: false, error: who.error };
  const res = await decideDraft(createAdminClient(), who.tenantSlug, parsed.data, {
    via: "in_app",
    userId: who.userId,
  });
  revalidatePath("/autopilot");
  return res;
}

export async function editInApp(input: unknown): Promise<DecideResult> {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const who = await requireManager();
  if ("error" in who) return { ok: false, error: who.error };
  return editDraft(createAdminClient(), who.tenantSlug, parsed.data);
}

export async function unapproveInApp(dmId: string): Promise<DecideResult> {
  if (!z.string().uuid().safeParse(dmId).success) return { ok: false, error: "Invalid request" };
  const who = await requireManager();
  if ("error" in who) return { ok: false, error: who.error };
  const res = await unapproveDraft(createAdminClient(), who.tenantSlug, dmId);
  revalidatePath("/autopilot");
  return res;
}

// ── Settings ────────────────────────────────────────────────────────────────

export async function saveMailboxAction(input: MailboxInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const who = await requireManager();
  if ("error" in who) return { ok: false, error: who.error };
  const parsed = mailboxInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the fields" };
  const res = await saveMailbox(createAdminClient(), who.tenantSlug, parsed.data, who.userId);
  revalidatePath("/settings/outreach");
  revalidatePath("/autopilot");
  return res;
}

export async function setAutopilotEnabled(enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const who = await requireManager();
  if ("error" in who) return { ok: false, error: who.error };
  const { data, error } = await createAdminClient()
    .from("outreach_mailboxes")
    .update({ enabled: Boolean(enabled), updated_by: who.userId, updated_at: new Date().toISOString() })
    .eq("tenant_slug", who.tenantSlug)
    .select("tenant_slug")
    .maybeSingle();
  if (error) return { ok: false, error: "Could not save" };
  if (!data) return { ok: false, error: "Set up the mailbox first" };
  revalidatePath("/autopilot");
  revalidatePath("/settings/outreach");
  return { ok: true };
}

/** Sends one test email from the workspace mailbox to the approver. */
export async function sendTestEmailAction(): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  const who = await requireManager();
  if ("error" in who) return { ok: false, error: who.error };
  const box = await getMailboxWithSecret(createAdminClient(), who.tenantSlug);
  if (!box) return { ok: false, error: "Save the mailbox first" };
  const text = "This is a test from Pulse Autopilot. If you can read this, outreach email from this mailbox works.";
  try {
    const t = await createSmtpTransport(box.config, box.password);
    await t.sendMail({
      from: formatFrom(box.config),
      to: box.config.approverEmail,
      subject: "Pulse Autopilot test",
      text,
      html: textToHtml(text),
      messageId: `<test-${Date.now()}@${box.config.fromEmail.split("@")[1]}>`,
    });
    t.close?.();
    return { ok: true, to: box.config.approverEmail };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Send failed";
    return { ok: false, error: `Mail server said: ${msg.slice(0, 200)}` };
  }
}

const listField = z.array(z.string().trim().min(1).max(400)).max(12);
const copySchema = z.object({
  defaultSegment: z.string().trim().min(1).max(60),
  segments: z
    .record(z.string().trim().min(1).max(60), z.object({ proof: listField, offer: listField, ask: listField }))
    .refine((r) => Object.keys(r).length > 0 && Object.keys(r).length <= 15, "Add 1 to 15 segments"),
  signature: z.string().trim().min(1).max(500),
  ideaPrefix: z.string().trim().min(1).max(120),
  followUp1Body: z.string().trim().min(10).max(3000),
  followUp2Body: z.string().trim().min(10).max(3000),
  bannedWords: z.array(z.string().trim().min(1).max(60)).max(80),
});

export type OutreachCopyInput = z.infer<typeof copySchema>;

/**
 * Saves the editable outreach copy. Banned words come in as a plain list and
 * are turned into the regex here, so nobody hand-writes a regex (and no one
 * can save a catastrophic one).
 */
export async function saveOutreachCopyAction(
  input: OutreachCopyInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const who = await requireManager();
  if ("error" in who) return { ok: false, error: who.error };
  const parsed = copySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the fields" };
  const v = parsed.data;
  if (!v.segments[v.defaultSegment]) return { ok: false, error: "The default segment must be one of your segments" };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("outreach_configs")
    .select("workspace, promise_regex, banned_regex")
    .eq("workspace", who.tenantSlug)
    .maybeSingle();

  const bannedRegex = rebuildBannedRegex(v.bannedWords, existing?.banned_regex as string | undefined);
  try {
    new RegExp(bannedRegex, "i");
  } catch {
    return { ok: false, error: "One of the banned words could not be saved" };
  }
  if (bannedRegex.length > 4000) return { ok: false, error: "Too many banned words" };

  const row = {
    workspace: who.tenantSlug,
    default_segment: v.defaultSegment,
    segments: v.segments,
    signature: v.signature,
    idea_prefix: v.ideaPrefix,
    follow_up_1_body: v.followUp1Body,
    follow_up_2_body: v.followUp2Body,
    banned_regex: bannedRegex,
    promise_regex: (existing?.promise_regex as string) ?? "\\b(I will|I'll|we will|we'll) (build|make|create|design|send)\\b",
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("outreach_configs").upsert(row, { onConflict: "workspace" });
  revalidatePath("/settings/outreach");
  return error ? { ok: false, error: "Could not save" } : { ok: true };
}
