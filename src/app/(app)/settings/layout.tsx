import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { getCurrentTenant } from "@/lib/auth";

// `support`-role members are UI-restricted to the Account group (Profile,
// Security, Notifications, Appearance) — every other /settings/* section
// is business config (brand, publishing, integrations) outside their
// scope. This is a second line of defense on top of migration 103's real
// RLS restriction (is_support_member() policies), not the actual security
// boundary — a support-role member hitting one of these pages directly
// still can't read/write the underlying tenant-scoped tables even if this
// redirect were ever bypassed.
const SUPPORT_ALLOWED_SETTINGS_PATHS = [
  "/settings/profile",
  "/settings/security",
  "/settings/notifications",
  "/settings/appearance",
];

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenant = await getCurrentTenant();

  if (tenant?.role === "support") {
    const pathname = (await headers()).get("x-pathname") ?? "";
    const isAllowed =
      pathname === "/settings" ||
      SUPPORT_ALLOWED_SETTINGS_PATHS.some(
        (p) => pathname === p || pathname.startsWith(`${p}/`)
      );
    if (!isAllowed) redirect("/settings/profile");
  }

  return (
    <div className="p-4 md:p-8 max-w-[1200px] mx-auto">
      <div className="md:flex md:gap-8">
        <SettingsNav accountType={tenant?.accountType ?? "startup"} role={tenant?.role} />
        <div className="flex-1 min-w-0 mt-4 md:mt-0">{children}</div>
      </div>
    </div>
  );
}
