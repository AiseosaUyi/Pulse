// Live unresolved-queue count on the Dashboard nav row. Async server
// component, same convention as NeedsYouBadge.tsx — computes on every
// request, renders nothing when there's nothing open.

import { createClient } from "@/lib/supabase/server";
import { listActionQueue } from "@/lib/services/action-queue";

export async function ActionQueueBadge({ tenantSlug }: { tenantSlug: string }) {
  const supabase = await createClient();
  const { total } = await listActionQueue(supabase, tenantSlug, {});
  if (total === 0) return null;

  return (
    <span className="ml-auto text-[11px] font-semibold px-1.5 py-0.5 rounded-full min-w-[20px] text-center bg-primary-50 text-primary-500">
      {total}
    </span>
  );
}
