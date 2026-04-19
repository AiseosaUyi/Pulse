import { redirect } from "next/navigation";

// Settings is an IA hub now — each section is its own route under
// /settings/<section>. Landing on /settings drops you into Profile
// since that's the most common entry point.
export default function SettingsLanding() {
  redirect("/settings/profile");
}
