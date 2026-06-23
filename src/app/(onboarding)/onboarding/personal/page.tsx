import { redirect } from "next/navigation";
import { getCurrentTenant } from "@/lib/auth";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { PersonalOnboardingClient } from "./client";

export default async function PersonalOnboardingPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/login");
  // Startups belong in the audit wizard; individuals who are already set up skip ahead.
  if (tenant.accountType !== "individual") redirect("/onboarding/audit");
  const voice = await getBrandVoice(tenant.slug);
  if (voice) redirect("/composer");

  return <PersonalOnboardingClient tenantSlug={tenant.slug} />;
}
