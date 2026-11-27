import { FeatureGate } from "@/components/features/FeatureGate";

export default function IntelFeatureLayout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="intel">{children}</FeatureGate>;
}
