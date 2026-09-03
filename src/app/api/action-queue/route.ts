// Client-poll driver for the dashboard's Action Queue (20s interval — see
// ActionQueueBoard.tsx). Session-authed (RLS applies via createClient()),
// not the token-authed /api/v1 pattern — mirrors /api/conversations/list.
// Deliberately session-scoped rather than admin: this is the real second
// fence for a support-role viewer (see migration 105's action_items RLS),
// not just the UI's own group-filtering.

import { NextResponse } from "next/server";
import { getCurrentTenant, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listActionQueue, type QueueKind, type QueuePriority, type QueueStatus } from "@/lib/services/action-queue";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenant = await getCurrentTenant();
  if (!tenant) return NextResponse.json({ error: "No tenant selected" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const supabase = await createClient();

  const result = await listActionQueue(supabase, tenant.slug, {
    status: (searchParams.get("status") as QueueStatus) ?? undefined,
    kind: (searchParams.get("kind") as QueueKind) ?? undefined,
    priority: (searchParams.get("priority") as QueuePriority) ?? undefined,
    assignedTo: searchParams.get("assignedTo") ?? undefined,
    platform: searchParams.get("platform") ?? undefined,
    currentUserId: user.id,
  });

  return NextResponse.json(result);
}
