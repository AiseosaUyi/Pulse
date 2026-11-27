import { FeatureGate } from "@/components/features/FeatureGate";

export default function AutopilotFeatureLayout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="autopilot">{children}</FeatureGate>;
}
