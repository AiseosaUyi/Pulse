import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { listVideoProjects } from "@/lib/services/video-projects";
import { VideoProjectsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function VideoStudioPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/signup?step=company");

  const projects = await listVideoProjects(tenant.slug);
  return <VideoProjectsClient projects={projects} />;
}
