import { cookies } from "next/headers";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { BrandVoiceEditor } from "@/components/briefs/BrandVoiceEditor";

export default async function BrandVoicePage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const voice = await getBrandVoice(tenantSlug);

  return (
    <div className="p-4 md:p-8 max-w-[760px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-foreground">
          Brand voice
        </h1>
        <p className="text-text-secondary text-sm mt-0.5">
          Ground the AI in your actual voice. Feeds every generated brief.
        </p>
      </div>

      <BrandVoiceEditor tenantSlug={tenantSlug} initial={voice} />
    </div>
  );
}
