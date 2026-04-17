import { cookies } from "next/headers";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { listBriefs } from "@/lib/services/briefs";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { ContentBriefsClient } from "./client";

export default async function ContentBriefsPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const [briefs, voice] = await Promise.all([
    listBriefs(tenantSlug, { includeDismissed: true }),
    getBrandVoice(tenantSlug),
  ]);

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

      <ContentBriefsClient
        briefs={briefs}
        tenantSlug={tenantSlug}
        hasVoice={voice !== null}
      />
    </div>
  );
}
