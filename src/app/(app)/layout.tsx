import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { MobileNav } from "@/components/sidebar/MobileNav";
import { getCurrentUser, getUserTenants, getCurrentTenant } from "@/lib/auth";

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

  return (
    <>
      <MobileNav tenants={tenants} currentTenantSlug={currentSlug} />
      <div className="flex h-full">
        <div className="hidden md:block">
          <Sidebar tenants={tenants} currentTenantSlug={currentSlug} />
        </div>
        <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
          {children}
        </main>
      </div>
    </>
  );
}
