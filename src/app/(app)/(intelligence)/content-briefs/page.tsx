import { redirect } from "next/navigation";

// /content-briefs merged into /ai-content?tab=briefs. Kept here as a
// permanent redirect so older links and the nav still resolve.
export default function ContentBriefsRedirectPage() {
  redirect("/ai-content?tab=briefs");
}
