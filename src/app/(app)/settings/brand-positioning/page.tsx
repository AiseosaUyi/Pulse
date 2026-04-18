import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, Target } from "lucide-react";
import { getBrandPositioning } from "@/lib/ai/brand-positioning";
import { BrandPositioningEditor } from "@/components/settings/BrandPositioningEditor";

export default async function BrandPositioningPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const positioning = await getBrandPositioning(tenantSlug);

  return (
    <div className="p-4 md:p-8 max-w-[960px]">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-foreground mb-4"
      >
        <ArrowLeft size={14} />
        Back to settings
      </Link>

      <div className="flex items-start gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center shrink-0">
          <Target size={18} className="text-primary-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Brand positioning
          </h1>
          <p className="text-text-secondary text-sm mt-0.5">
            The *what* and *who* that feeds every AI generation in Pulse.
            Brand voice (tone, do/don&apos;t) lives separately — both layer
            together on every call.
          </p>
        </div>
      </div>

      <BrandPositioningEditor
        tenantSlug={tenantSlug}
        initial={positioning}
      />
    </div>
  );
}
