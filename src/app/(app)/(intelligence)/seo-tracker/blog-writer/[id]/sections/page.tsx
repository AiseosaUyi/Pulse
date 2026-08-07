import { notFound } from "next/navigation";
import { getCurrentTenant } from "@/lib/auth";
import { getBlogPostRecord } from "@/lib/services/blog-posts";
import { SectionBuilderClient } from "./client";

export default async function BlogSectionBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const currentTenant = await getCurrentTenant();
  const tenantSlug = currentTenant?.slug ?? "";

  const post = await getBlogPostRecord(tenantSlug, id);
  if (!post) notFound();

  return <SectionBuilderClient post={post} tenantSlug={tenantSlug} />;
}
