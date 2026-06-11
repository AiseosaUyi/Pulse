/* eslint-disable @next/next/no-img-element */
// Brand-graphics templates rendered by next/og's ImageResponse at request time.
// Each template is a pure function (params -> React element); the render route
// wraps it in an ImageResponse. $0/graphic, no design tool. Brand color
// defaults to Gruve maroon and can be overridden per call.

import React from "react";

export interface GraphicParams {
  headline?: string;
  subhead?: string;
  price?: string;
  oldPrice?: string;
  cta?: string;
  brandName?: string;
  bg?: string; // background hex
  accent?: string; // accent hex
  fg?: string; // foreground/text hex
}

export interface GraphicTemplate {
  slug: string;
  name: string;
  fields: string[]; // param keys this template uses
  render: (p: Required<Pick<GraphicParams, "bg" | "accent" | "fg">> & GraphicParams) => React.ReactElement;
}

const BASE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  padding: 96,
  fontFamily: "sans-serif",
};

export const GRAPHIC_TEMPLATES: GraphicTemplate[] = [
  {
    slug: "price-drop",
    name: "Price drop",
    fields: ["headline", "price", "oldPrice", "cta", "brandName"],
    render: (p) => (
      <div style={{ ...BASE, background: p.bg, justifyContent: "space-between" }}>
        <div style={{ display: "flex", color: p.accent, fontSize: 40, fontWeight: 700, letterSpacing: 2 }}>
          {(p.brandName ?? "").toUpperCase()}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", color: p.fg, fontSize: 84, fontWeight: 800, lineHeight: 1.05 }}>
            {p.headline ?? "Weekend price drop"}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", marginTop: 40, gap: 24 }}>
            {p.oldPrice ? (
              <div style={{ display: "flex", color: "#9aa0a6", fontSize: 56, textDecoration: "line-through" }}>
                {p.oldPrice}
              </div>
            ) : null}
            <div style={{ display: "flex", color: p.accent, fontSize: 120, fontWeight: 900 }}>
              {p.price ?? ""}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", background: p.accent, color: "#fff", fontSize: 44, fontWeight: 700, padding: "28px 48px", borderRadius: 999, alignSelf: "flex-start" }}>
          {p.cta ?? "Order now"}
        </div>
      </div>
    ),
  },
  {
    slug: "market-math",
    name: "Market math",
    fields: ["headline", "subhead", "cta", "brandName"],
    render: (p) => (
      <div style={{ ...BASE, background: p.bg, justifyContent: "center", alignItems: "center", textAlign: "center" }}>
        <div style={{ display: "flex", color: p.accent, fontSize: 36, fontWeight: 700, letterSpacing: 2, marginBottom: 24 }}>
          {(p.brandName ?? "").toUpperCase()}
        </div>
        <div style={{ display: "flex", color: p.fg, fontSize: 96, fontWeight: 900, lineHeight: 1.05 }}>
          {p.headline ?? "Do the math"}
        </div>
        <div style={{ display: "flex", color: "#9aa0a6", fontSize: 48, marginTop: 32, maxWidth: 760 }}>
          {p.subhead ?? ""}
        </div>
        <div style={{ display: "flex", background: p.accent, color: "#fff", fontSize: 42, fontWeight: 700, padding: "24px 44px", borderRadius: 999, marginTop: 56 }}>
          {p.cta ?? "Order now"}
        </div>
      </div>
    ),
  },
  {
    slug: "product-spotlight",
    name: "Product spotlight",
    fields: ["headline", "subhead", "price", "cta", "brandName"],
    render: (p) => (
      <div style={{ ...BASE, background: p.bg, justifyContent: "flex-end" }}>
        <div style={{ display: "flex", color: p.accent, fontSize: 36, fontWeight: 700, letterSpacing: 2 }}>
          {(p.brandName ?? "").toUpperCase()}
        </div>
        <div style={{ display: "flex", color: p.fg, fontSize: 92, fontWeight: 900, marginTop: 16, lineHeight: 1.05 }}>
          {p.headline ?? "Today's pick"}
        </div>
        <div style={{ display: "flex", color: "#9aa0a6", fontSize: 44, marginTop: 20 }}>
          {p.subhead ?? ""}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 48 }}>
          <div style={{ display: "flex", color: p.accent, fontSize: 96, fontWeight: 900 }}>
            {p.price ?? ""}
          </div>
          <div style={{ display: "flex", background: p.accent, color: "#fff", fontSize: 40, fontWeight: 700, padding: "24px 44px", borderRadius: 999 }}>
            {p.cta ?? "Order now"}
          </div>
        </div>
      </div>
    ),
  },
];

export function getTemplate(slug: string): GraphicTemplate | undefined {
  return GRAPHIC_TEMPLATES.find((t) => t.slug === slug);
}
