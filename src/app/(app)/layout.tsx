import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { MobileNav } from "@/components/sidebar/MobileNav";
import { DialogProvider } from "@/components/ui/Dialog";
import { Toaster } from "@/components/ui/Toaster";
import { RouteProgress } from "@/components/ui/RouteProgress";
import { getCurrentUser, getUserTenants, getCurrentTenant } from "@/lib/auth";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { getOnboardingProgress } from "@/lib/services/onboarding";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const tenants = await getUserTenants();
  if (tenants.length === 0) redirect("/signup?step=company");

  const currentTenant = await getCurrentTenant();
  const currentSlug = currentTenant?.slug ?? tenants[0].slug;
  const currentName = currentTenant?.name ?? tenants[0].name;
  const currentAccountType = currentTenant?.accountType ?? tenants[0].accountType;

  // Onboarding gate: a tenant without brand voice hasn't been set up yet.
  // Both personas need brand voice (the composer/AI calls depend on it), so
  // we gate on the same check — but route to the persona's own setup flow.
  // Startups get the brand-audit wizard; individuals get the lighter personal
  // setup. Once voice is set (or skipped), they land in the app.
  const voice = await getBrandVoice(currentSlug);
  if (!voice) {
    redirect(
      currentAccountType === "individual" ? "/onboarding/personal" : "/onboarding/audit"
    );
  }

  const onboardingProgress = await getOnboardingProgress(currentSlug);

  return (
    <DialogProvider>
      <RouteProgress />
      <MobileNav
        tenants={tenants}
        currentTenantSlug={currentSlug}
        currentTenantName={currentName}
        currentAccountType={currentAccountType}
        onboardingProgress={onboardingProgress}
      />
      <div className="flex h-full">
        <div className="hidden md:block">
          <Sidebar
            tenants={tenants}
            currentTenantSlug={currentSlug}
            currentTenantName={currentName}
            currentAccountType={currentAccountType}
            onboardingProgress={onboardingProgress}
          />
        </div>
        <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
          {children}
        </main>
      </div>
      <Toaster />
    </DialogProvider>
  );
}
