import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { GraphicsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function GraphicsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/signup?step=company");

  return <GraphicsClient brandName={tenant.name} />;
}
