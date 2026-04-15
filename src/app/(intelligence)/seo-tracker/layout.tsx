import { SEOTabNav } from "@/components/seo/SEOTabNav";

export default function SEOLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-white">SEO Command Center</h1>
        <p className="text-text-secondary text-sm mt-0.5">
          100x your organic growth with AI-powered SEO
        </p>
      </div>
      <SEOTabNav />
      {children}
    </div>
  );
}
