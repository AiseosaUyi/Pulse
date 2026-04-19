import { SettingsNav } from "@/components/settings/SettingsNav";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="p-4 md:p-8 max-w-[1200px] mx-auto">
      <div className="md:flex md:gap-8">
        <SettingsNav />
        <div className="flex-1 min-w-0 mt-4 md:mt-0">{children}</div>
      </div>
    </div>
  );
}
