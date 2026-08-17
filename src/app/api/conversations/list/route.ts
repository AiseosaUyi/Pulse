// Client-poll driver for the conversation list pane (20s interval — see
// ConversationsInbox.tsx). Session-authed (RLS applies via createClient()),
// not the token-authed /api/v1 pattern — mirrors the video status poller
// (src/app/api/video/projects/[id]/status/route.ts).

import { NextResponse } from "next/server";
import { getCurrentTenant, getCurrentUser } from "@/lib/auth";
import { listConversations } from "@/lib/services/conversations";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenant = await getCurrentTenant();
  if (!tenant) return NextResponse.json({ error: "No tenant selected" }, { status: 400 });

  const conversations = await listConversations(tenant.slug);
  return NextResponse.json({ conversations });
}
