// Client-poll driver for an open thread panel (15s interval — see
// ThreadPanel.tsx). Session-authed (RLS applies via createClient()), same
// pattern as .../conversations/list/route.ts and the video status poller.

import { NextResponse } from "next/server";
import { getCurrentTenant, getCurrentUser } from "@/lib/auth";
import { getConversationThread } from "@/lib/services/conversations";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenant = await getCurrentTenant();
  if (!tenant) return NextResponse.json({ error: "No tenant selected" }, { status: 400 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const thread = await getConversationThread(tenant.slug, id);
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(thread);
}
