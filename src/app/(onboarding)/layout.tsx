// Onboarding layout — minimal shell, no sidebar, no brand-voice gate.
// Sits between (auth) (pre-account) and (app) (full product). A user
// has signed up and has at least one tenant, but hasn't finished the
// brand audit yet.

import { redirect } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { getCurrentUser, getUserTenants } from "@/lib/auth";

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const tenants = await getUserTenants();
  if (tenants.length === 0) redirect("/signup?step=company");

  return (
    <div className="min-h-screen flex flex-col bg-white-50 dark:bg-background">
      <header className="w-full px-6 py-5 flex items-center">
        <Logo size="md" />
      </header>
      <main className="flex-1 flex items-start md:items-center justify-center px-4 pb-10">
        <div className="w-full max-w-2xl">{children}</div>
      </main>
    </div>
  );
}
