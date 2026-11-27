import { FeatureGate } from "@/components/features/FeatureGate";

export default function PostHistoryFeatureLayout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="post_history">{children}</FeatureGate>;
}
