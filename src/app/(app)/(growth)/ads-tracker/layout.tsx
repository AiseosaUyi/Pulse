import { FeatureGate } from "@/components/features/FeatureGate";

export default function AdsFeatureLayout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="ads">{children}</FeatureGate>;
}
