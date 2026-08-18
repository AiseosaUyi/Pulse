// Sidebar entry point for the "Needs You" checklist — a server component so
// it can fetch the tenant's own live setup status without a client round
// trip. Rendered once per page load alongside the rest of the sidebar.

import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { getSetupStatus } from "@/lib/services/setup-status";
import { cn } from "@/lib/utils";

export async function NeedsYouBadge({
  tenantSlug,
  accountType,
}: {
  tenantSlug: string;
  accountType: "startup" | "individual";
}) {
  const status = await getSetupStatus(tenantSlug, accountType);
  const openCount = status.total - status.doneCount;
  if (openCount === 0) return null;

  const p0Count = status.items.filter((i) => !i.done && i.priority === "P0").length;

  return (
    <Link
      href="/needs-you"
      className="mx-3 mb-2 flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm border border-border hover:bg-gray-50 transition-colors duration-200"
    >
      <CircleAlert
        size={16}
        className={cn(p0Count > 0 ? "text-status-red" : "text-status-yellow")}
      />
      <span className="flex-1 text-gray-1000 [font-family:'Satoshi-500',var(--font-sans)]">
        Needs you
      </span>
      <span
        className={cn(
          "text-[11px] font-semibold px-1.5 py-0.5 rounded-full min-w-[20px] text-center",
          p0Count > 0
            ? "bg-status-red/10 text-status-red"
            : "bg-status-yellow/10 text-status-yellow"
        )}
      >
        {openCount}
      </span>
    </Link>
  );
}
