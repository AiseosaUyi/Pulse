import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";

// Minimal shell for standalone public pages that have no session and no
// (app) sidebar/layout — currently just /approve/[token] (Part 3 of the
// /api/v1 + MCP build spec). Deliberately stripped: no nav, no account
// menu, nothing for the user to navigate to.
export function PublicPageShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="min-h-dvh bg-background flex flex-col">
      <header className="h-14 flex items-center px-4 shrink-0">
        <Logo size="sm" as="span" />
      </header>
      <main className={cn("flex-1 w-full max-w-[480px] mx-auto px-4 pt-6", className)}>
        {children}
      </main>
    </div>
  );
}
