import { FeatureGate } from "@/components/features/FeatureGate";

export default function ScheduleFeatureLayout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="schedule">{children}</FeatureGate>;
}
