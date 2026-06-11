import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { listOrders, getOrderStats } from "@/lib/services/orders";
import { OrdersClient } from "./client";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/signup?step=company");

  const [orders, stats] = await Promise.all([
    listOrders(tenant.slug, 100),
    getOrderStats(tenant.slug, 30),
  ]);

  return <OrdersClient orders={orders} stats={stats} />;
}
