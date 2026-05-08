import { ContentVaultTabs } from "./_tabs";

export default function ContentVaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Content Vault</h1>
        <p className="text-text-secondary text-sm mt-0.5">
          Save reference content + run your team's content operations.
        </p>
      </div>

      <ContentVaultTabs />

      {children}
    </div>
  );
}
