import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import {
  listVideoCharacters,
  listGenerations,
  listApprovedContentForVideo,
  getAssetUrls,
} from "@/lib/services/video-projects";
import { isPicsartConfigured, getPicsartProvider } from "@/lib/video/providers/picsart";
import { VideoStudioClient } from "./client";

// Live PicsArt credit balance — best-effort; null if the provider/endpoint is
// unavailable so the UI degrades to showing just the estimate.
async function fetchCreditBalance(): Promise<number | null> {
  if (!isPicsartConfigured()) return null;
  try {
    return (await getPicsartProvider().creditBalance()).balance;
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";

export default async function VideoStudioPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/signup?step=company");

  const [characters, generations, approvedContent, creditBalance] = await Promise.all([
    listVideoCharacters(tenant.slug),
    listGenerations(tenant.slug),
    listApprovedContentForVideo(tenant.slug),
    fetchCreditBalance(),
  ]);

  // First reference image per character → avatar thumbnail.
  const avatarIds = characters
    .map((c) => c.referenceAssetIds[0])
    .filter(Boolean) as string[];
  const avatarUrls = await getAssetUrls(tenant.slug, avatarIds);
  const characterAvatars: Record<string, string> = {};
  for (const c of characters) {
    const first = c.referenceAssetIds[0];
    if (first && avatarUrls[first]) characterAvatars[c.id] = avatarUrls[first];
  }

  return (
    <VideoStudioClient
      characters={characters}
      characterAvatars={characterAvatars}
      generations={generations}
      approvedContent={approvedContent}
      providerConfigured={isPicsartConfigured()}
      creditBalance={creditBalance}
    />
  );
}
