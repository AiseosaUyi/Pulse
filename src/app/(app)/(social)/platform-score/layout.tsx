import { FeatureGate } from "@/components/features/FeatureGate";

export default function PlatformScoreFeatureLayout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="platform_score">{children}</FeatureGate>;
}
