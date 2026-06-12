import { redirect, notFound } from "next/navigation";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { getVideoProject, getAssetUrls } from "@/lib/services/video-projects";
import { VideoProjectDetail } from "./client";

export const dynamic = "force-dynamic";

export default async function VideoProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/signup?step=company");

  const { id } = await params;
  const data = await getVideoProject(tenant.slug, id);
  if (!data) notFound();

  const assetIds = [
    data.project.assembledOutputAssetId,
    ...data.clips.map((c) => c.outputAssetId),
  ].filter(Boolean) as string[];
  const assetUrls = await getAssetUrls(tenant.slug, assetIds);

  return (
    <VideoProjectDetail
      project={data.project}
      clips={data.clips}
      assetUrls={assetUrls}
    />
  );
}
