import { SettingsNav } from "@/components/settings/SettingsNav";
import { getCurrentTenant } from "@/lib/auth";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenant = await getCurrentTenant();
  return (
    <div className="p-4 md:p-8 max-w-[1200px] mx-auto">
      <div className="md:flex md:gap-8">
        <SettingsNav accountType={tenant?.accountType ?? "startup"} />
        <div className="flex-1 min-w-0 mt-4 md:mt-0">{children}</div>
      </div>
    </div>
  );
}
