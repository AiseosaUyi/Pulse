import { FeatureGate } from "@/components/features/FeatureGate";
import { SEOPageHeader } from "@/components/seo/SEOPageHeader";

export default function SEOLayout({ children }: { children: React.ReactNode }) {
  return (
    <FeatureGate feature="seo">
      <div className="p-4 md:p-8 max-w-[1400px]">
        <SEOPageHeader />
        {children}
      </div>
    </FeatureGate>
  );
}
