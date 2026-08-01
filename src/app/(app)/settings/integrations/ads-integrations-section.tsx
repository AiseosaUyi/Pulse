"use client";

import { useState, useTransition } from "react";
import { Megaphone, CheckCircle2, Loader2, Trash2, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDialogs } from "@/components/ui/Dialog";
import {
  initiateComposioConnection,
  confirmComposioConnection,
  disconnectComposioAccount,
} from "@/lib/actions/composio";
import {
  savePixelConfigAction,
  subscribeMetaWebhookAction,
  disconnectTikTokAdsAction,
} from "@/lib/actions/ads-platform";
import type { AdAccountRecord } from "@/lib/types/ads-platform";

const META_ADS_ALIAS = "ads";

interface MetaAdsConnectionRow {
  id: string;
  alias: string;
  status: string;
  displayName: string | null;
}

interface TikTokAdsConnectionRow {
  id: string;
  advertiserId: string;
  advertiserName: string | null;
  status: string;
  lastError: string | null;
}

function PixelConfigForm({ account }: { account: AdAccountRecord }) {
  const [metaPixelId, setMetaPixelId] = useState(account.metaPixelId ?? "");
  const [metaCapiToken, setMetaCapiToken] = useState("");
  const [tiktokPixelCode, setTiktokPixelCode] = useState(account.tiktokPixelCode ?? "");
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "info" | "error"; text: string } | null>(null);

  const onSave = () => {
    setMessage(null);
    startTransition(async () => {
      const res = await savePixelConfigAction(account.id, {
        ...(account.platform === "meta" ? { metaPixelId: metaPixelId || null } : {}),
        ...(account.platform === "meta" && metaCapiToken ? { metaCapiToken } : {}),
        ...(account.platform === "tiktok" ? { tiktokPixelCode: tiktokPixelCode || null } : {}),
      });
      if (!res.success) {
        setMessage({ type: "error", text: res.error });
        return;
      }
      setMetaCapiToken("");
      setMessage({ type: "info", text: "Saved." });
    });
  };

  const onSubscribeWebhook = () => {
    setMessage(null);
    startTransition(async () => {
      const res = await subscribeMetaWebhookAction(account.id);
      setMessage(
        res.success
          ? { type: "info", text: "Subscribed — creative fatigue and disapproval alerts will now arrive via webhook." }
          : { type: "error", text: res.error }
      );
    });
  };

  return (
    <div className="mt-3 pt-3 border-t border-border/40 space-y-2">
      <p className="text-[11px] text-text-muted uppercase tracking-wide">Server-side conversion tracking (CAPI)</p>
      {account.platform === "meta" ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={metaPixelId}
            onChange={(e) => setMetaPixelId(e.target.value)}
            placeholder="Meta Pixel ID"
            className="text-sm rounded border border-border/50 bg-background px-2 py-1.5 text-foreground w-40"
          />
          <input
            value={metaCapiToken}
            onChange={(e) => setMetaCapiToken(e.target.value)}
            type="password"
            placeholder={account.metaCapiConfigured ? "Token saved — enter to replace" : "System User access token"}
            className="text-sm rounded border border-border/50 bg-background px-2 py-1.5 text-foreground w-56"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={onSave}
            className="text-xs px-3 py-1.5 rounded bg-primary-500 text-white hover:bg-primary-500/90 disabled:opacity-50 font-medium"
          >
            Save
          </button>
          {account.metaCapiConfigured && (
            <button
              type="button"
              disabled={isPending}
              onClick={onSubscribeWebhook}
              className="text-xs px-3 py-1.5 rounded border border-border/50 text-foreground hover:border-primary-500/50 inline-flex items-center gap-1"
            >
              <Radio size={12} />
              Subscribe to webhook alerts
            </button>
          )}
          {account.metaCapiConfigured && <span className="text-[11px] text-status-green">Token configured</span>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={tiktokPixelCode}
            onChange={(e) => setTiktokPixelCode(e.target.value)}
            placeholder="TikTok Pixel code"
            className="text-sm rounded border border-border/50 bg-background px-2 py-1.5 text-foreground w-56"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={onSave}
            className="text-xs px-3 py-1.5 rounded bg-primary-500 text-white hover:bg-primary-500/90 disabled:opacity-50 font-medium"
          >
            Save
          </button>
          <span className="text-[11px] text-text-muted">Reuses the Marketing API token already on this connection — no separate token needed.</span>
        </div>
      )}
      {message && (
        <p className={`text-xs ${message.type === "error" ? "text-status-red" : "text-text-secondary"}`}>{message.text}</p>
      )}
    </div>
  );
}

export function AdsIntegrationsSection({
  tenantSlug,
  metaConnections,
  tiktokConnections,
  tiktokConfigured,
  adAccounts,
  flash,
}: {
  tenantSlug: string;
  metaConnections: MetaAdsConnectionRow[];
  tiktokConnections: TikTokAdsConnectionRow[];
  tiktokConfigured: boolean;
  adAccounts: AdAccountRecord[];
  flash: { kind: "success" | "error"; message: string } | null;
}) {
  const dialogs = useDialogs();
  const [metaRows, setMetaRows] = useState(metaConnections);
  const [tiktokRows, setTiktokRows] = useState(tiktokConnections);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: "info" | "error"; message: string } | null>(null);

  const onConnectMeta = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await initiateComposioConnection({ tenantSlug, toolkit: "metaads", alias: META_ADS_ALIAS });
      if (!res.success) {
        setFeedback({ type: "error", message: res.error });
        return;
      }
      if (res.redirectUrl) window.open(res.redirectUrl, "_blank", "noopener,noreferrer");
      setFeedback({ type: "info", message: "Authorization window opened. Once you've approved access, click Confirm below." });
      setMetaRows((prev) => [
        ...prev.filter((r) => r.alias !== META_ADS_ALIAS),
        { id: res.connectionId, alias: META_ADS_ALIAS, status: "pending", displayName: null },
      ]);
    });
  };

  const onConfirmMeta = (connectionId: string) => {
    setFeedback(null);
    startTransition(async () => {
      const res = await confirmComposioConnection(connectionId);
      if (!res.success) {
        setFeedback({ type: "error", message: res.error });
        return;
      }
      setFeedback({ type: "info", message: `Connection status: ${res.status}` });
      setMetaRows((prev) => prev.map((r) => (r.id === connectionId ? { ...r, status: res.status === "ACTIVE" ? "active" : r.status } : r)));
    });
  };

  const onDisconnectMeta = async (rowId: string) => {
    const ok = await dialogs.confirm({
      title: "Disconnect Meta Ads?",
      subtitle: "Structure/insights sync, budget rules, and CAPI pushes for this connection will stop.",
      confirmLabel: "Disconnect",
      tone: "destructive",
    });
    if (!ok) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await disconnectComposioAccount(rowId);
      if (!res.success) {
        setFeedback({ type: "error", message: res.error });
        return;
      }
      setMetaRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, status: "revoked" } : r)));
    });
  };

  const onDisconnectTikTok = async (connectionId: string) => {
    const ok = await dialogs.confirm({
      title: "Disconnect TikTok Ads?",
      subtitle: "Structure/insights sync, budget rules, and Events API pushes for this advertiser will stop.",
      confirmLabel: "Disconnect",
      tone: "destructive",
    });
    if (!ok) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await disconnectTikTokAdsAction(connectionId);
      if (!res.success) {
        setFeedback({ type: "error", message: res.error });
        return;
      }
      setTiktokRows((prev) => prev.map((r) => (r.id === connectionId ? { ...r, status: "revoked" } : r)));
    });
  };

  return (
    <section className="bg-card border border-border rounded-2xl p-6">
      <header className="mb-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
          <Megaphone size={18} className="text-primary-600" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">Ad accounts</h2>
          <p className="text-xs text-text-muted mt-1">
            Connect real Meta and TikTok ad accounts for spend, blended ROAS, budget guardrails, and server-side conversion tracking —
            separate from the Instagram/TikTok/LinkedIn social connections above.
          </p>
        </div>
      </header>

      {flash && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${flash.kind === "success" ? "bg-status-green/10 text-status-green" : "bg-red-500/10 text-red-600"}`}>
          {flash.message}
        </div>
      )}
      {feedback && (
        <p className={`text-xs mb-3 ${feedback.type === "error" ? "text-status-red" : "text-text-secondary"}`}>{feedback.message}</p>
      )}

      <div className="space-y-4">
        <div className="rounded-xl border border-border/50 p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <p className="text-sm font-medium text-foreground">Meta Ads</p>
            <Button type="button" size="sm" disabled={isPending} onClick={onConnectMeta}>
              {isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
              Connect Meta Ads
            </Button>
          </div>
          {metaRows.filter((r) => r.status !== "revoked").length === 0 ? (
            <p className="text-xs text-text-muted">Not connected. Needs a Meta Business Manager with your ad account and Business Verification completed.</p>
          ) : (
            <ul className="divide-y divide-border/40">
              {metaRows.filter((r) => r.status !== "revoked").map((r) => (
                <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-foreground">{r.displayName ?? r.alias}</p>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded ${r.status === "active" ? "bg-status-green/10 text-status-green" : "bg-status-yellow/10 text-status-yellow"}`}>
                      {r.status}
                    </span>
                    {r.status === "pending" && (
                      <button type="button" disabled={isPending} onClick={() => onConfirmMeta(r.id)} className="text-[11px] px-2 py-1 rounded border border-border/50 text-foreground hover:border-primary-500/50">
                        Confirm
                      </button>
                    )}
                    <button type="button" disabled={isPending} onClick={() => onDisconnectMeta(r.id)} className="text-[11px] px-2 py-1 rounded text-status-red hover:bg-status-red/10">
                      Disconnect
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border/50 p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <p className="text-sm font-medium text-foreground">TikTok Ads</p>
            {tiktokConfigured ? (
              <Button type="button" size="sm" onClick={() => (window.location.href = "/api/integrations/tiktok-ads/connect")}>
                Connect TikTok Ads
              </Button>
            ) : (
              <span className="text-[11px] text-text-muted">Not configured on this deployment (needs TIKTOK_ADS_APP_ID/SECRET)</span>
            )}
          </div>
          {tiktokRows.filter((r) => r.status !== "revoked").length === 0 ? (
            <p className="text-xs text-text-muted">Not connected. Needs a TikTok Business Center with an approved Marketing API app.</p>
          ) : (
            <ul className="divide-y divide-border/40">
              {tiktokRows.filter((r) => r.status !== "revoked").map((r) => (
                <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-foreground">{r.advertiserName ?? r.advertiserId}</p>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded ${r.status === "active" ? "bg-status-green/10 text-status-green" : "bg-border/50 text-text-muted"}`}>
                      {r.status}
                    </span>
                    <button type="button" disabled={isPending} onClick={() => onDisconnectTikTok(r.id)} className="text-[11px] px-2 py-1 rounded text-status-red hover:bg-status-red/10 inline-flex items-center gap-1">
                      <Trash2 size={11} />
                      Disconnect
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {adAccounts.length > 0 && (
          <div className="rounded-xl border border-border/50 p-4">
            <p className="text-sm font-medium text-foreground mb-1">Conversion tracking per ad account</p>
            <p className="text-xs text-text-muted mb-3">
              Feeds real purchases from Pulse&apos;s order webhook back into each platform&apos;s optimization signal, and recovers events
              a browser pixel alone misses (ad blockers, iOS ATT).
            </p>
            <ul className="space-y-3">
              {adAccounts.map((a) => (
                <li key={a.id}>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-status-green flex-shrink-0" />
                    <p className="text-xs text-foreground font-medium">
                      {a.accountName ?? a.externalAccountId} <span className="text-text-muted">({a.platform})</span>
                    </p>
                  </div>
                  <PixelConfigForm account={a} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <details className="rounded-xl border border-border/50 p-4">
          <summary className="text-sm font-medium text-foreground cursor-pointer">Before real data flows — external setup checklist</summary>
          <ul className="mt-3 text-xs text-text-muted space-y-1.5 list-disc list-inside">
            <li>Meta: Business Verification on the Business Manager (can take ~20 days), then App Review for Advanced/Full Access to the Marketing API.</li>
            <li>Meta: a System User access token with ads_management scope, entered above as the CAPI token — Composio manages the social login but can&apos;t expose a raw token for CAPI/webhook calls.</li>
            <li>TikTok: a Marketing API developer app approved by TikTok for Business, with <code>TIKTOK_ADS_APP_ID</code>/<code>TIKTOK_ADS_APP_SECRET</code> set in the deployment environment.</li>
            <li>Meta webhook alerts (creative fatigue, disapprovals) need <code>META_APP_SECRET</code> and <code>META_WEBHOOK_VERIFY_TOKEN</code> set at the deployment level, then the &quot;Subscribe to webhook alerts&quot; button above per account.</li>
            <li>None of this blocks the rest of Pulse — until connected, the manual campaign tracker on the Ads page still works.</li>
          </ul>
        </details>
      </div>
    </section>
  );
}
