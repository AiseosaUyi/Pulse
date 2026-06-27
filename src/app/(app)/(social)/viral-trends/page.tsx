import { redirect } from "next/navigation";

export default function ViralTrendsRedirect() {
  redirect("/intel-feed?tab=trends");
}
