// Meta Ad Account webhooks — push delivery for signals that would
// otherwise need polling: creative_fatigue (Meta's own detector, Low/Med/
// High severity — no ML to build on Pulse's side), with_issues_ad_objects
// (disapprovals/errors), ad_recommendations, effective_status changes.
// Setup: GET handles Meta's subscription-verification handshake; POST
// receives real payloads. Per-ad-account subscription is registered via
// subscribeMetaAdAccountWebhook (called once when an account is first
// synced — see sync-ad-structure cron).

import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAdAlert } from "@/lib/services/ad-alerts";
import type { AdInsightsLevel } from "@/lib/types/ads-platform";

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface MetaWebhookChange {
  field: string;
  value: Record<string, unknown>;
}

interface MetaWebhookEntry {
  id: string; // ad_account_id, e.g. 'act_123' or bare numeric id depending on subscription
  changes?: MetaWebhookChange[];
}

const FATIGUE_SEVERITY_MAP: Record<string, "low" | "medium" | "high"> = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  if (!verifySignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: { object?: string; entry?: MetaWebhookEntry[] };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (payload.object !== "adaccount" || !payload.entry) {
    return new Response("ok", { status: 200 });
  }

  const admin = createAdminClient();

  for (const entry of payload.entry) {
    const externalAccountId = entry.id.startsWith("act_") ? entry.id : `act_${entry.id}`;
    const { data: account } = await admin
      .from("ad_accounts")
      .select("id, tenant_slug")
      .eq("platform", "meta")
      .eq("external_account_id", externalAccountId)
      .maybeSingle();
    if (!account) continue; // webhook for an account we don't track (shouldn't happen, but don't crash)

    for (const change of entry.changes ?? []) {
      await handleChange(account.id, account.tenant_slug, change);
    }
  }

  return new Response("ok", { status: 200 });
}

async function handleChange(adAccountId: string, tenantSlug: string, change: MetaWebhookChange): Promise<void> {
  const value = change.value;
  const objectId = (value.ad_id as string) ?? (value.adset_id as string) ?? (value.campaign_id as string) ?? "";
  const level: AdInsightsLevel = value.ad_id ? "ad" : value.adset_id ? "adset" : "campaign";
  if (!objectId) return;

  switch (change.field) {
    case "creative_fatigue": {
      const severityRaw = String(value.severity ?? "").toUpperCase();
      await createAdAlert({
        tenantSlug,
        adAccountId,
        level,
        externalId: objectId,
        alertType: "creative_fatigue",
        severity: FATIGUE_SEVERITY_MAP[severityRaw] ?? "medium",
        message: `Meta detected creative fatigue (${severityRaw || "unknown severity"}) on this ${level}.`,
        raw: value,
      });
      break;
    }
    case "with_issues_ad_objects": {
      await createAdAlert({
        tenantSlug,
        adAccountId,
        level,
        externalId: objectId,
        alertType: "with_issues",
        severity: "high",
        message: String(value.error_message ?? value.description ?? `This ${level} has a delivery issue.`),
        raw: value,
      });
      break;
    }
    case "ad_recommendations": {
      await createAdAlert({
        tenantSlug,
        adAccountId,
        level,
        externalId: objectId,
        alertType: "recommendation",
        severity: "low",
        message: String(value.title ?? value.recommendation ?? "Meta has an optimization recommendation for this ad."),
        raw: value,
      });
      break;
    }
    default:
      // effective_status and other change types: not alert-worthy on their
      // own, structure sync already reconciles status on its own cadence.
      break;
  }
}
