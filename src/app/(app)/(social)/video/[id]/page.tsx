import { redirect, notFound } from "next/navigation";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import {
  getVideoProject,
  getAssetUrls,
  listVideoCharacters,
} from "@/lib/services/video-projects";
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
  const [data, characters] = await Promise.all([
    getVideoProject(tenant.slug, id),
    listVideoCharacters(tenant.slug),
  ]);
  if (!data) notFound();

  // Resolve every asset the page renders: assembled output, per-clip outputs,
  // per-clip input assets (source video / frames) so the editor can preview
  // what's attached, and each character's first reference image as an avatar.
  const assetIds = [
    data.project.assembledOutputAssetId,
    ...data.clips.flatMap((c) => [
      c.outputAssetId,
      c.sourceVideoAssetId,
      c.startFrameAssetId,
      c.endFrameAssetId,
    ]),
    ...characters.map((c) => c.referenceAssetIds[0]),
  ].filter(Boolean) as string[];
  const assetUrls = await getAssetUrls(tenant.slug, assetIds);

  const characterAvatars: Record<string, string> = {};
  for (const c of characters) {
    const first = c.referenceAssetIds[0];
    if (first && assetUrls[first]) characterAvatars[c.id] = assetUrls[first];
  }

  return (
    <VideoProjectDetail
      project={data.project}
      clips={data.clips}
      assetUrls={assetUrls}
      characters={characters}
      characterAvatars={characterAvatars}
    />
  );
}
