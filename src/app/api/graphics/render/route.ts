// Renders a branded promo graphic as a PNG via next/og. Stateless and
// preview-friendly: GET /api/graphics/render?template=price-drop&headline=...
// Returns 1080×1350 (IG portrait). Brand color defaults to Gruve maroon and is
// overridable with ?accent/?bg/?fg. Auth-light by design (no secrets); it only
// renders whatever text is in the query string.

import { ImageResponse } from "next/og";
import { getTemplate } from "@/lib/graphics/templates";

export const dynamic = "force-dynamic";

const DEFAULTS = { bg: "#0e0e10", accent: "#ad112c", fg: "#ffffff" };

export function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams;
  const tmpl = getTemplate(q.get("template") ?? "price-drop");
  if (!tmpl) {
    return new Response("Unknown template", { status: 404 });
  }

  const params = {
    bg: q.get("bg") ?? DEFAULTS.bg,
    accent: q.get("accent") ?? DEFAULTS.accent,
    fg: q.get("fg") ?? DEFAULTS.fg,
    headline: q.get("headline") ?? undefined,
    subhead: q.get("subhead") ?? undefined,
    price: q.get("price") ?? undefined,
    oldPrice: q.get("oldPrice") ?? undefined,
    cta: q.get("cta") ?? undefined,
    brandName: q.get("brandName") ?? undefined,
  };

  return new ImageResponse(tmpl.render(params), {
    width: 1080,
    height: 1350,
  });
}
