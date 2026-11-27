import { FeatureGate } from "@/components/features/FeatureGate";

export default function VideoFeatureLayout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="video">{children}</FeatureGate>;
}
