import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { listVideoCharacters, getAssetUrls } from "@/lib/services/video-projects";
import { CharactersClient } from "./client";

export const dynamic = "force-dynamic";

export default async function VideoCharactersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/signup?step=company");

  const characters = await listVideoCharacters(tenant.slug);
  const allRefIds = characters.flatMap((c) => c.referenceAssetIds);
  const assetUrls = await getAssetUrls(tenant.slug, allRefIds);

  return <CharactersClient characters={characters} assetUrls={assetUrls} />;
}
