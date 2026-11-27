import { FeatureGate } from "@/components/features/FeatureGate";

export default function AnalyticsFeatureLayout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="analytics">{children}</FeatureGate>;
}
