"use client";

/* eslint-disable @next/next/no-img-element */
import { useMemo, useState } from "react";
import { Image as ImageIcon, Download } from "lucide-react";
import { GRAPHIC_TEMPLATES } from "@/lib/graphics/templates";

const ALL_FIELDS = [
  "headline",
  "subhead",
  "price",
  "oldPrice",
  "cta",
  "brandName",
] as const;

export function GraphicsClient({ brandName = "" }: { brandName?: string }) {
  const [slug, setSlug] = useState(GRAPHIC_TEMPLATES[0]?.slug ?? "price-drop");
  const [values, setValues] = useState<Record<string, string>>({
    brandName,
    headline: "Weekend price drop",
    price: "₦4,500",
    oldPrice: "₦6,000",
    cta: "Order on WhatsApp",
  });
  const [accent, setAccent] = useState("#ad112c");

  const template = GRAPHIC_TEMPLATES.find((t) => t.slug === slug);
  const usedFields = template?.fields ?? [];

  const src = useMemo(() => {
    const q = new URLSearchParams({ template: slug, accent });
    for (const f of usedFields) {
      if (values[f]) q.set(f, values[f]);
    }
    return `/api/graphics/render?${q.toString()}`;
  }, [slug, accent, usedFields, values]);

  return (
    <div className="p-4 md:p-8 max-w-[1100px] mx-auto">
      <header className="flex items-center gap-2 mb-6">
        <ImageIcon size={20} className="text-primary-500" />
        <div>
          <h1 className="text-xl md:text-2xl text-gray-1100 dark:text-foreground">
            Graphics studio
          </h1>
          <p className="text-sm text-text-muted mt-0.5">
            Branded promo cards rendered on the fly — no design tool, $0 each.
          </p>
        </div>
      </header>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {GRAPHIC_TEMPLATES.map((t) => (
              <button
                key={t.slug}
                onClick={() => setSlug(t.slug)}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                  slug === t.slug
                    ? "bg-primary-500 text-white"
                    : "bg-card border border-border text-text-secondary"
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>

          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            {ALL_FIELDS.filter((f) => usedFields.includes(f)).map((f) => (
              <label key={f} className="block">
                <span className="text-xs text-text-muted mb-1 block capitalize">
                  {f}
                </span>
                <input
                  value={values[f] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f]: e.target.value }))
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </label>
            ))}
            <label className="block">
              <span className="text-xs text-text-muted mb-1 block">
                Accent color
              </span>
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="h-9 w-16 rounded border border-border bg-background"
              />
            </label>
            <a
              href={src}
              download="graphic.png"
              className="inline-flex items-center gap-1.5 rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium"
            >
              <Download size={15} /> Download PNG
            </a>
          </div>
        </section>

        <section>
          <div className="bg-card border border-border rounded-2xl p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt="Graphic preview"
              className="w-full rounded-xl"
              style={{ aspectRatio: "1080 / 1350" }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
