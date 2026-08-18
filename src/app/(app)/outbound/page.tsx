import { redirect } from "next/navigation";

// "Outbound" is the product name used everywhere else (nav label, docs,
// MCP tool scopes), but the actual route has always been /leads — a
// guessed /outbound URL used to 404. This alias is purely additive.
export default function OutboundRedirect() {
  redirect("/leads");
}
