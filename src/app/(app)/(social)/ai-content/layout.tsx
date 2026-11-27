import { FeatureGate } from "@/components/features/FeatureGate";

export default function ContentLibraryFeatureLayout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="content_library">{children}</FeatureGate>;
}
