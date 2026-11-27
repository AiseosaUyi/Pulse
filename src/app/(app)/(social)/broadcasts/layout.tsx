import { FeatureGate } from "@/components/features/FeatureGate";

export default function BroadcastsFeatureLayout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="broadcasts">{children}</FeatureGate>;
}
