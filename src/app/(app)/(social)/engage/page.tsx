import { redirect } from "next/navigation";

export default function EngageRedirect() {
  redirect("/conversations?tab=join");
}
