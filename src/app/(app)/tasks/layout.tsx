import { FeatureGate } from "@/components/features/FeatureGate";

export default function TasksFeatureLayout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="tasks">{children}</FeatureGate>;
}
