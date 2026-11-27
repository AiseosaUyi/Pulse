import { FeatureGate } from "@/components/features/FeatureGate";

export default function ComposerFeatureLayout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="composer">{children}</FeatureGate>;
}
