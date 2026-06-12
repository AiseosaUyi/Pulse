// WhatsApp Cloud API wrapper (Meta Graph API), multi-tenant.
//
// Each tenant connects its own number (whatsapp_accounts, migration 058):
//   - inbound webhooks route to a tenant by phone_number_id
//   - outbound sends use that tenant's phone id + access token
//
// A single env-configured number is still supported as an explicit fallback
// (handy for the first tenant before the UI is wired) — set ALL of:
//   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_FALLBACK_TENANT
// The platform-level webhook handshake token is WHATSAPP_VERIFY_TOKEN.

import { createAdminClient } from "@/lib/supabase/admin";

const GRAPH = "https://graph.facebook.com/v21.0";

export interface WhatsappAccount {
  tenantSlug: string;
  phoneNumberId: string;
  accessToken: string;
}

function envFallback(): WhatsappAccount | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const tenantSlug = process.env.WHATSAPP_FALLBACK_TENANT;
  if (phoneNumberId && accessToken && tenantSlug) {
    return { tenantSlug, phoneNumberId, accessToken };
  }
  return null;
}

interface AccountRow {
  tenant_slug: string;
  phone_number_id: string;
  access_token: string;
}

// Resolve a tenant's WhatsApp account (DB first, then env fallback if that env
// tenant matches). Returns null when the tenant has no number connected.
export async function getWhatsappAccount(
  tenantSlug: string
): Promise<WhatsappAccount | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("whatsapp_accounts")
    .select("tenant_slug, phone_number_id, access_token")
    .eq("tenant_slug", tenantSlug)
    .neq("status", "disconnected")
    .maybeSingle();
  if (data) {
    const row = data as AccountRow;
    return {
      tenantSlug: row.tenant_slug,
      phoneNumberId: row.phone_number_id,
      accessToken: row.access_token,
    };
  }
  const fallback = envFallback();
  return fallback && fallback.tenantSlug === tenantSlug ? fallback : null;
}

// Resolve the tenant that owns an inbound number (by phone_number_id from the
// webhook payload). Used to route inbound messages to the right tenant.
export async function getWhatsappAccountByPhoneId(
  phoneNumberId: string
): Promise<WhatsappAccount | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("whatsapp_accounts")
    .select("tenant_slug, phone_number_id, access_token")
    .eq("phone_number_id", phoneNumberId)
    .neq("status", "disconnected")
    .maybeSingle();
  if (data) {
    const row = data as AccountRow;
    return {
      tenantSlug: row.tenant_slug,
      phoneNumberId: row.phone_number_id,
      accessToken: row.access_token,
    };
  }
  const fallback = envFallback();
  return fallback && fallback.phoneNumberId === phoneNumberId ? fallback : null;
}

export async function isWhatsappConnected(tenantSlug: string): Promise<boolean> {
  return (await getWhatsappAccount(tenantSlug)) !== null;
}

type SendResult = { ok: true; messageId: string } | { ok: false; error: string };

async function postMessage(
  account: WhatsappAccount,
  payload: Record<string, unknown>
): Promise<SendResult> {
  try {
    const res = await fetch(`${GRAPH}/${account.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    });
    const json = (await res.json()) as {
      messages?: Array<{ id: string }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      return { ok: false, error: json.error?.message ?? `WhatsApp API ${res.status}` };
    }
    return { ok: true, messageId: json.messages?.[0]?.id ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "send failed" };
  }
}

// Free-form text — only deliverable inside the 24h customer-service window.
export function sendWhatsappText(
  account: WhatsappAccount,
  to: string,
  body: string
): Promise<SendResult> {
  return postMessage(account, { to, type: "text", text: { body } });
}

// Template message — required to initiate outside the 24h window (broadcasts).
export function sendWhatsappTemplate(
  account: WhatsappAccount,
  to: string,
  templateName: string,
  languageCode = "en",
  bodyParams: string[] = []
): Promise<SendResult> {
  const components =
    bodyParams.length > 0
      ? [
          {
            type: "body",
            parameters: bodyParams.map((text) => ({ type: "text", text })),
          },
        ]
      : undefined;
  return postMessage(account, {
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components ? { components } : {}),
    },
  });
}

export interface InboundWhatsappMessage {
  phoneNumberId: string; // which tenant number received it
  from: string; // sender phone (E.164 without +)
  id: string; // wamid
  text: string;
  timestamp: string; // unix seconds as string
}

// Parse a Cloud API webhook body into inbound text messages, each tagged with
// the receiving phone_number_id so it can be routed to the owning tenant.
export function parseInboundWebhook(
  payload: unknown
): InboundWhatsappMessage[] {
  const out: InboundWhatsappMessage[] = [];
  const entries =
    (payload as { entry?: Array<{ changes?: Array<{ value?: unknown }> }> })
      ?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value as
        | {
            messages?: Array<Record<string, unknown>>;
            metadata?: { phone_number_id?: string };
          }
        | undefined;
      const phoneNumberId = value?.metadata?.phone_number_id ?? "";
      for (const msg of value?.messages ?? []) {
        const text = (msg.text as { body?: string } | undefined)?.body;
        if (!text) continue; // skip non-text (media/status) for now
        out.push({
          phoneNumberId,
          from: String(msg.from ?? ""),
          id: String(msg.id ?? ""),
          text,
          timestamp: String(msg.timestamp ?? ""),
        });
      }
    }
  }
  return out;
}
