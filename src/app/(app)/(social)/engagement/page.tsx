import { redirect } from "next/navigation";

export default function EngagementRedirect() {
  redirect("/conversations?tab=inbox");
}
