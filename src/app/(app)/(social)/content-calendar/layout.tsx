import { FeatureGate } from "@/components/features/FeatureGate";

export default function ContentCalendarFeatureLayout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="content_calendar">{children}</FeatureGate>;
}
