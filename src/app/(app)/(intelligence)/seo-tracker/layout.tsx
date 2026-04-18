import { SEOPageHeader } from "@/components/seo/SEOPageHeader";

export default function SEOLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-4 md:p-8 max-w-[1400px]">
      <SEOPageHeader />
      {children}
    </div>
  );
}
