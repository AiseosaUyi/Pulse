// One sending mailbox per workspace (migration 116). Gruve sends from a Gruve
// mailbox, Sippy from contact@sippy.life, both on the same mailcow server the
// two businesses already use. The password is stored AES-GCM encrypted and is
// never returned to a page.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { encryptToken, decryptToken } from "@/lib/integrations/platform-crypto";

export interface MailboxConfig {
  tenantSlug: string;
  fromEmail: string;
  fromName: string;
  replyTo: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  imapHost: string | null;
  imapPort: number;
  enabled: boolean;
  dailyCap: number;
  sendWindowStart: number;
  sendWindowEnd: number;
  sendWeekdays: number[];
  autoFollowUps: boolean;
  followUp1Days: number;
  followUp2Days: number;
  approverEmail: string;
  digestHour: number;
  autoCompose: boolean;
  lastDigestAt: string | null;
  imapUidValidity: number | null;
  imapLastUid: number | null;
  imapCheckedAt: string | null;
  lastError: string | null;
  hasPassword: boolean;
}

const COLUMNS =
  "tenant_slug, from_email, from_name, reply_to, smtp_host, smtp_port, smtp_user, smtp_password_enc, imap_host, imap_port, enabled, daily_cap, send_window_start, send_window_end, send_weekdays, auto_follow_ups, follow_up_1_days, follow_up_2_days, approver_email, digest_hour, auto_compose, last_digest_at, imap_uid_validity, imap_last_uid, imap_checked_at, last_error";

export function rowToMailbox(row: Record<string, unknown>): MailboxConfig {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    tenantSlug: row.tenant_slug as string,
    fromEmail: row.from_email as string,
    fromName: row.from_name as string,
    replyTo: (row.reply_to as string) ?? null,
    smtpHost: row.smtp_host as string,
    smtpPort: Number(row.smtp_port),
    smtpUser: row.smtp_user as string,
    imapHost: (row.imap_host as string) ?? null,
    imapPort: Number(row.imap_port ?? 993),
    enabled: Boolean(row.enabled),
    dailyCap: Number(row.daily_cap),
    sendWindowStart: Number(row.send_window_start),
    sendWindowEnd: Number(row.send_window_end),
    sendWeekdays: ((row.send_weekdays as number[]) ?? [1, 2, 3, 4, 5]).map(Number),
    autoFollowUps: Boolean(row.auto_follow_ups),
    followUp1Days: Number(row.follow_up_1_days),
    followUp2Days: Number(row.follow_up_2_days),
    approverEmail: row.approver_email as string,
    digestHour: Number(row.digest_hour),
    autoCompose: Boolean(row.auto_compose),
    lastDigestAt: (row.last_digest_at as string) ?? null,
    imapUidValidity: num(row.imap_uid_validity),
    imapLastUid: num(row.imap_last_uid),
    imapCheckedAt: (row.imap_checked_at as string) ?? null,
    lastError: (row.last_error as string) ?? null,
    hasPassword: Boolean(row.smtp_password_enc),
  };
}

/** Config without the password, safe to hand to a page. */
export async function getMailbox(
  admin: SupabaseClient,
  tenantSlug: string
): Promise<MailboxConfig | null> {
  const { data } = await admin
    .from("outreach_mailboxes")
    .select(COLUMNS)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();
  return data ? rowToMailbox(data as Record<string, unknown>) : null;
}

/** Config plus the decrypted password. Server-only callers that send or read mail. */
export async function getMailboxWithSecret(
  admin: SupabaseClient,
  tenantSlug: string
): Promise<{ config: MailboxConfig; password: string } | null> {
  const { data } = await admin
    .from("outreach_mailboxes")
    .select(COLUMNS)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return { config: rowToMailbox(row), password: decryptToken(row.smtp_password_enc as string) };
}

export async function listEnabledMailboxTenants(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin.from("outreach_mailboxes").select("tenant_slug").eq("enabled", true);
  return (data ?? []).map((r) => r.tenant_slug as string);
}

const hostRe = /^[a-z0-9.-]+$/i;

export const mailboxInputSchema = z
  .object({
    fromEmail: z.string().trim().toLowerCase().email(),
    fromName: z.string().trim().min(1).max(80),
    replyTo: z.string().trim().toLowerCase().email().nullable(),
    smtpHost: z.string().trim().regex(hostRe, "Host name only, no scheme"),
    smtpPort: z.number().int().refine((p) => [25, 465, 587, 2525].includes(p), "Use 465, 587 or 2525"),
    smtpUser: z.string().trim().min(1).max(200),
    /** Empty keeps the stored password. */
    smtpPassword: z.string().max(500),
    imapHost: z.string().trim().regex(hostRe, "Host name only, no scheme").nullable(),
    imapPort: z.number().int().refine((p) => [143, 993].includes(p), "Use 993 or 143"),
    enabled: z.boolean(),
    dailyCap: z.number().int().min(1).max(200),
    sendWindowStart: z.number().int().min(0).max(23),
    sendWindowEnd: z.number().int().min(1).max(24),
    sendWeekdays: z.array(z.number().int().min(1).max(7)).min(1),
    autoFollowUps: z.boolean(),
    followUp1Days: z.number().int().min(1).max(30),
    followUp2Days: z.number().int().min(2).max(60),
    approverEmail: z.string().trim().toLowerCase().email(),
    digestHour: z.number().int().min(0).max(23),
    autoCompose: z.boolean(),
  })
  .refine((v) => v.sendWindowEnd > v.sendWindowStart, {
    message: "Send window must end after it starts",
    path: ["sendWindowEnd"],
  })
  .refine((v) => v.followUp2Days > v.followUp1Days, {
    message: "Second follow-up must come after the first",
    path: ["followUp2Days"],
  });

export type MailboxInput = z.infer<typeof mailboxInputSchema>;

export async function saveMailbox(
  admin: SupabaseClient,
  tenantSlug: string,
  input: MailboxInput,
  userId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await admin
    .from("outreach_mailboxes")
    .select("smtp_password_enc")
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();

  const password = input.smtpPassword.trim();
  if (!password && !existing.data?.smtp_password_enc) {
    return { ok: false, error: "Mailbox password is required" };
  }

  const row: Record<string, unknown> = {
    tenant_slug: tenantSlug,
    from_email: input.fromEmail,
    from_name: input.fromName,
    reply_to: input.replyTo,
    smtp_host: input.smtpHost,
    smtp_port: input.smtpPort,
    smtp_user: input.smtpUser,
    imap_host: input.imapHost,
    imap_port: input.imapPort,
    enabled: input.enabled,
    daily_cap: input.dailyCap,
    send_window_start: input.sendWindowStart,
    send_window_end: input.sendWindowEnd,
    send_weekdays: [...new Set(input.sendWeekdays)].sort(),
    auto_follow_ups: input.autoFollowUps,
    follow_up_1_days: input.followUp1Days,
    follow_up_2_days: input.followUp2Days,
    approver_email: input.approverEmail,
    digest_hour: input.digestHour,
    auto_compose: input.autoCompose,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  if (password) row.smtp_password_enc = encryptToken(password);

  const { error } = await admin.from("outreach_mailboxes").upsert(row, { onConflict: "tenant_slug" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function setMailboxState(
  admin: SupabaseClient,
  tenantSlug: string,
  patch: Record<string, unknown>
): Promise<void> {
  await admin
    .from("outreach_mailboxes")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("tenant_slug", tenantSlug);
}

/** Minimal shape the sender needs; lets tests pass a fake. */
export interface MailTransport {
  sendMail(msg: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    replyTo?: string;
    messageId: string;
    inReplyTo?: string;
    references?: string[];
    headers?: Record<string, string>;
  }): Promise<{ messageId?: string; accepted?: unknown[]; rejected?: unknown[] }>;
  close?(): void;
}

export async function createSmtpTransport(config: MailboxConfig, password: string): Promise<MailTransport> {
  const nodemailer = (await import("nodemailer")).default;
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    requireTLS: config.smtpPort !== 465,
    auth: { user: config.smtpUser, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  }) as unknown as MailTransport;
}

export function formatFrom(config: Pick<MailboxConfig, "fromName" | "fromEmail">): string {
  const name = config.fromName.replace(/["\\\r\n]/g, "");
  return `"${name}" <${config.fromEmail}>`;
}
