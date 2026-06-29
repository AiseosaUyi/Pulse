import { getCurrentTenant } from "@/lib/auth";
import { listSavedContent } from "@/lib/services/saved-content";
import { listTrendScouts } from "@/lib/services/trends";
import { getStorageUsage } from "@/lib/services/storage-usage";
import { StorageMeter } from "@/components/vault/StorageMeter";
import { ContentExtractor } from "../content-extractor";
import { VaultClient } from "../client";

// Extraction server action may take up to ~40s on first hit when the
// self-hosted cobalt instance is cold (Render free tier spins down
// after 15 min idle, then needs ~15-30s to boot). Give the function
// 60s ceiling so the first extraction of the session completes.
export const maxDuration = 60;

export default async function VaultSavedPage() {
  const tenant = await getCurrentTenant();
  const tenantSlug = tenant?.slug ?? "";

  const [saved, trends, storage] = await Promise.all([
    listSavedContent(tenantSlug),
    listTrendScouts(tenantSlug, { limit: 10 }),
    getStorageUsage(),
  ]);

  const usedCount = saved.filter((c) => c.status === "used").length;
  const scheduledCount = saved.filter((c) => c.status === "scheduled").length;
  const readyCount = saved.filter((c) => c.status === "new").length;

  return (
    <>
      <div className="mb-6">
        <StorageMeter usage={storage} />
      </div>

      <ContentExtractor tenantSlug={tenantSlug} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Total saved</p>
          <p className="text-2xl font-bold text-foreground mt-1">
            {saved.length}
          </p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Ready to use</p>
          <p className="text-2xl font-bold text-status-green mt-1">
            {readyCount}
          </p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Used</p>
          <p className="text-2xl font-bold text-primary-500 mt-1">{usedCount}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Scheduled</p>
          <p className="text-2xl font-bold text-status-yellow mt-1">
            {scheduledCount}
          </p>
        </div>
      </div>

      <VaultClient
        tenantSlug={tenantSlug}
        saved={saved}
        trends={trends.map((t) => ({
          id: t.id,
          platform: t.platform,
          title: t.title ?? t.hashtag ?? t.externalUrl ?? "Untitled",
          summary: t.summary,
          url: t.externalUrl,
          views: t.metrics.views ?? 0,
          applicability: t.applicability ?? "low",
          thumbnailEmoji:
            t.platform === "tiktok"
              ? "🎵"
              : t.platform === "instagram"
                ? "📸"
                : "🔗",
        }))}
      />

      {saved.length === 0 && trends.length === 0 && (
        <div className="mt-6 bg-card rounded-2xl border border-dashed border-border p-8 text-center">
          <p className="text-foreground font-semibold mb-1">Vault is empty</p>
          <p className="text-text-muted text-sm max-w-[480px] mx-auto">
            Paste a TikTok, Instagram, or YouTube link above to save it here.
            Or approve intel cards and trends — they can be saved into the
            vault in one click.
          </p>
        </div>
      )}
    </>
  );
}
