import { Share2, ExternalLink, AlertCircle, CheckCircle2 } from "lucide-react";
import { SettingsPageHeading } from "../_shared";
import { YouTubeIcon } from "@/components/icons/social";
import { getCurrentTenant } from "@/lib/auth";
import {
  fetchAllSocialApiAccounts,
  getTenantSocialMappings,
  getAccountIdsClaimedByOtherTenants,
} from "@/lib/services/social-accounts";
import { isSocialApiConfigured } from "@/lib/integrations/socialapi";
import { isYouTubeConfigured } from "@/lib/integrations/platforms/youtube";
import { getAllPlatformConnections } from "@/lib/services/platform-connections";
import AccountLinker from "./AccountLinker";
import DisconnectButton from "./DisconnectButton";

export default async function SocialPublishingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const params = await searchParams;
  const tenant = await getCurrentTenant();
  const socialApiConfigured = isSocialApiConfigured();
  const youtubeConfigured = isYouTubeConfigured();

  let availableAccounts: Awaited<ReturnType<typeof fetchAllSocialApiAccounts>> = [];
  let linkedMappings: Awaited<ReturnType<typeof getTenantSocialMappings>> = [];
  let connections: Awaited<ReturnType<typeof getAllPlatformConnections>> = [];
  let fetchError: string | null = null;

  if (tenant) {
    connections = await getAllPlatformConnections(tenant.slug);
    if (socialApiConfigured) {
      try {
        const [allAccounts, mappings, claimedByOthers] = await Promise.all([
          fetchAllSocialApiAccounts(),
          getTenantSocialMappings(tenant.slug),
          getAccountIdsClaimedByOtherTenants(tenant.slug),
        ]);
        // Only show accounts not already claimed by another tenant
        availableAccounts = allAccounts.filter((a) => !claimedByOthers.has(a.id));
        linkedMappings = mappings;
      } catch (err) {
        fetchError = err instanceof Error ? err.message : "Failed to load accounts";
      }
    }
  }

  const youtubeConn = connections.find((c) => c.platform === "youtube");

  return (
    <div>
      <SettingsPageHeading
        icon={Share2}
        title="Social Publishing"
        subtitle="Link your social accounts to schedule and publish posts directly from Pulse."
      />

      {params.connected === "youtube" && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-700 dark:bg-green-950/40 dark:text-green-300">
          <CheckCircle2 size={15} />
          YouTube connected successfully.
        </div>
      )}
      {params.error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle size={15} />
          {decodeURIComponent(params.error)}
        </div>
      )}

      <div className="space-y-6">
        {/* YouTube — direct OAuth, free */}
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">YouTube</p>
          <div className="bg-card border border-border rounded-2xl p-5 flex items-center gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: "#FF000015" }}>
              <span style={{ color: "#FF0000" }}><YouTubeIcon size={20} /></span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm text-foreground">YouTube</span>
                {youtubeConn && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-950/40 dark:border-green-700 dark:text-green-400">
                    <CheckCircle2 size={9} />
                    {youtubeConn.platformHandle ?? "Connected"}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                Direct OAuth — free. Community posts require 500+ subscribers.
              </p>
            </div>
            <div className="shrink-0">
              {youtubeConn ? (
                <DisconnectButton platform="youtube" />
              ) : (
                <a
                  href={youtubeConfigured ? "/api/integrations/youtube/connect" : undefined}
                  aria-disabled={!youtubeConfigured}
                  className={[
                    "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    youtubeConfigured
                      ? "border-primary-500 bg-primary-500 text-white hover:opacity-90"
                      : "border-border text-text-muted cursor-not-allowed opacity-50 pointer-events-none",
                  ].join(" ")}
                >
                  Connect
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Instagram / LinkedIn / TikTok — via SocialAPI.ai */}
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">
            Instagram · LinkedIn · TikTok
          </p>

          {!socialApiConfigured ? (
            <div className="rounded-2xl border border-dashed border-border p-6 space-y-3">
              <p className="text-sm text-text-muted">
                These platforms connect via{" "}
                <a href="https://social-api.ai" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                  SocialAPI.ai
                </a>
                {" "}— no platform app reviews needed.
              </p>
              <ol className="space-y-1.5 text-sm text-text-muted list-decimal list-inside">
                <li>Sign up at social-api.ai (free Hobby plan or $29/mo Side Hustle)</li>
                <li>Copy your API key from their dashboard</li>
                <li>Paste your API key into your deployment settings and redeploy</li>
                <li>Come back here to link accounts</li>
              </ol>
              <a
                href="https://social-api.ai/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-primary-500 bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
              >
                Open SocialAPI.ai <ExternalLink size={13} />
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-text-muted flex items-center justify-between gap-4">
                <span>
                  Connect accounts in your{" "}
                  <a
                    href="https://social-api.ai/dashboard"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary inline-flex items-center gap-0.5"
                  >
                    SocialAPI.ai dashboard <ExternalLink size={11} />
                  </a>
                  , then link them below.
                </span>
              </div>

              {fetchError ? (
                <div className="flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300">
                  <AlertCircle size={15} />
                  {fetchError}
                </div>
              ) : (
                <AccountLinker
                  key={tenant?.slug}
                  availableAccounts={availableAccounts}
                  linkedMappings={linkedMappings}
                />
              )}
            </div>
          )}
        </div>

        {/* X note */}
        <p className="text-xs text-text-muted">
          X (Twitter) isn&apos;t available for direct publishing. Use the Composer to copy drafts and post manually.
        </p>
      </div>
    </div>
  );
}
