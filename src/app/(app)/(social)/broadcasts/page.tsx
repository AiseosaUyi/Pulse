import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import {
  listBroadcastLists,
  listBroadcastMessages,
} from "@/lib/services/broadcasts";
import { BroadcastsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function BroadcastsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/signup?step=company");

  const [lists, messages] = await Promise.all([
    listBroadcastLists(tenant.slug),
    listBroadcastMessages(tenant.slug),
  ]);

  return <BroadcastsClient lists={lists} messages={messages} />;
}
