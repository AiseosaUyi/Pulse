import { redirect } from "next/navigation";
import { getCurrentTenant } from "@/lib/auth";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { AuditWizardClient } from "./client";

export default async function OnboardingAuditPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/login");

  // If the tenant already has a voice, skip the wizard and go straight
  // into the app. A user can always re-run the audit from /settings.
  const voice = await getBrandVoice(tenant.slug);
  if (voice) redirect("/dashboard");

  return (
    <AuditWizardClient tenantSlug={tenant.slug} tenantName={tenant.name} />
  );
}
