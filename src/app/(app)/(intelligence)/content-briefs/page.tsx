import { cookies } from "next/headers";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { listBriefs } from "@/lib/services/briefs";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { BriefCard } from "@/components/briefs/BriefCard";

export default async function ContentBriefsPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const [briefs, voice] = await Promise.all([
    listBriefs(tenantSlug),
    getBrandVoice(tenantSlug),
  ]);

  const hasVoice = voice !== null;

  return (
    <div className="p-4 md:p-8 max-w-[1000px]">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">
            Content briefs
          </h1>
          <p className="text-text-secondary text-sm mt-0.5">
            AI-generated content strategies, grounded in your brand voice
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/settings/brand-voice"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs text-foreground hover:bg-card-hover transition-colors"
          >
            <Sparkles size={12} />
            Brand voice
          </Link>
          <span className="text-sm text-text-muted">
            {briefs.length} brief{briefs.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {!hasVoice && (
        <div className="rounded-2xl border-2 border-dashed border-border p-6 md:p-8 mb-6 text-center">
          <h3 className="text-foreground font-semibold mb-1">
            Add your brand voice to unlock briefs
          </h3>
          <p className="text-text-muted text-sm mb-4 max-w-md mx-auto">
            Without a brand voice, the generator falls back to generic output.
            Takes about 30 minutes to set up, one-time.
          </p>
          <Link
            href="/settings/brand-voice"
            className="inline-flex items-center px-4 py-2 bg-primary text-white rounded-full text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Set brand voice
          </Link>
        </div>
      )}

      {briefs.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border p-12 text-center">
          <h3 className="text-foreground font-semibold mb-1">
            No briefs yet
          </h3>
          <p className="text-text-muted text-sm">
            Head to the{" "}
            <Link href="/intel-feed" className="text-primary hover:underline">
              Intel Feed
            </Link>{" "}
            and tap &quot;Generate&quot; on a competitor post to create your
            first brief.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {briefs.map((brief) => (
            <BriefCard key={brief.id} brief={brief} tenantSlug={tenantSlug} />
          ))}
        </div>
      )}
    </div>
  );
}
