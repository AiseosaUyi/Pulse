// scripts/seed-sippy-brand-and-seo.mjs
// Seeds Sippy's brand voice (in tenants.settings) and programmatic SEO templates.
// Idempotent: brand voice is upserted into settings JSONB; templates are inserted
// only if no templates exist yet for the sippy tenant.
//
// Run: node --env-file=.env.local scripts/seed-sippy-brand-and-seo.mjs

import { createClient } from "@supabase/supabase-js";

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TENANT = "sippy";

// ── Brand voice ──────────────────────────────────────────────────────────────
const BRAND_VOICE = {
  tone: "Friendly, fast, and no-nonsense. We make ordering drinks feel as easy as texting a friend.",
  audience:
    "Lagos young professionals, 22–38, who love convenience. They order drinks for house parties, " +
    "dates, and late-night cravings. On their phones, appreciate speed, and don't want to overthink it.",
  do_list: [
    "Use Lagos-native language and local references (Lekki, VI, Ikeja, Surulere)",
    "Keep it short and punchy — Sippy delivers fast, so copy should too",
    "Lead with the convenience: 30-minute delivery",
    "Name actual neighborhoods and occasions — make it feel local and real",
    "Be specific about drinks: beer, wine, spirits, cocktail mixers — not just 'drinks'",
  ],
  dont_list: [
    "Don't be formal or corporate",
    "Don't bury the CTA — tell them to order now",
    "Don't use vague 'premium' language without backing it up",
    "Don't overclaim — real Lagosians know hype",
    "Don't write long paragraphs — Sippy users are on mobile, scanning fast",
  ],
  example_posts: [
    "Friday vibes need the right drinks. Order in 30 mins or less — Sippy's got Lagos covered.",
    "No time for a store run? Your beer is closer than you think. Order now, delivered cold.",
    "Hosting tonight? Let Sippy handle the drinks. Just tell us what and where — we'll be there.",
  ],
};

// ── Programmatic SEO templates ───────────────────────────────────────────────
const TEMPLATES = [
  {
    name: "Drinks delivery by area — Lagos",
    title_pattern: "{drink} delivery in {area} Lagos | Order Now — Sippy",
    url_pattern: "drinks/{drink}/lagos/{area}",
    meta_description_pattern:
      "Order {drink} delivery in {area} Lagos. Fast, cold, and delivered to your door. Browse brands, check prices, and get it in 30 minutes.",
    content_prompt:
      "Write a landing page for {drink} delivery in {area}, Lagos via Sippy. " +
      "Cover: why Sippy is the fastest option (30-min delivery promise), what brands and varieties are available, " +
      "how the ordering process works (app/web), the delivery area in {area}, and include a strong CTA. " +
      "Local neighborhood references are welcome. Tone: friendly, direct, mobile-first. " +
      "Structure: H1 hero, 3-4 short sections, one FAQ block, CTA at end.",
    target_word_count: 700,
    variables: [
      {
        name: "drink",
        values: [
          "beer",
          "wine",
          "whiskey",
          "champagne",
          "gin",
          "vodka",
          "spirits",
          "cocktail mixers",
        ],
      },
      {
        name: "area",
        values: [
          "Lekki",
          "Victoria Island",
          "Ikeja",
          "Ikoyi",
          "Surulere",
          "Yaba",
          "Ajah",
          "Gbagada",
        ],
      },
    ],
  },
  {
    name: "Buy drinks online by city",
    title_pattern: "Buy {drink} Online in {city} | Fast Delivery — Sippy",
    url_pattern: "buy/{drink}/online/{city}",
    meta_description_pattern:
      "Buy {drink} online in {city}. Wide selection, competitive prices, delivered cold and fast. Order on Sippy today.",
    content_prompt:
      "Write a landing page for buying {drink} online in {city} via Sippy. " +
      "Cover: the convenience of online ordering vs. going to a store, what brands and price ranges Sippy stocks, " +
      "delivery speed and coverage in {city}, trust signals (cold-chain, sealed bottles, real-time tracking), " +
      "and a clear CTA. Tone: confident, helpful, direct. No filler paragraphs.",
    target_word_count: 600,
    variables: [
      {
        name: "drink",
        values: ["beer", "wine", "whiskey", "gin", "vodka", "rum", "champagne"],
      },
      {
        name: "city",
        values: ["Lagos", "Abuja", "Port Harcourt"],
      },
    ],
  },
  {
    name: "Drinks for occasions",
    title_pattern: "Order Drinks for {occasion} in {city} | Sippy",
    url_pattern: "drinks-for/{occasion}/{city}",
    meta_description_pattern:
      "Planning a {occasion} in {city}? Sippy delivers beer, wine, spirits & mixers to your door. Fast, cold, hassle-free.",
    content_prompt:
      "Write a landing page for ordering drinks for a {occasion} in {city} via Sippy. " +
      "Cover: what drinks work best for this occasion (be specific with recommendations), " +
      "how much to order per person/group, why Sippy is the right choice (speed, selection, cold delivery), " +
      "how to order (simple steps), and a clear CTA to start the order. " +
      "Tone: like advice from a knowledgeable friend. Keep sections short, scannable.",
    target_word_count: 650,
    variables: [
      {
        name: "occasion",
        values: [
          "house party",
          "birthday",
          "date night",
          "wedding",
          "office event",
          "pool party",
        ],
      },
      {
        name: "city",
        values: ["Lagos", "Abuja"],
      },
    ],
  },
  {
    name: "Same-day alcohol delivery by area",
    title_pattern: "Same-Day Alcohol Delivery in {area} | Sippy Lagos",
    url_pattern: "same-day-alcohol-delivery/{area}",
    meta_description_pattern:
      "Same-day alcohol delivery in {area}. Order by 10pm — get it in 30 minutes. Beer, wine, spirits and more.",
    content_prompt:
      "Write a landing page for same-day alcohol delivery in {area} via Sippy. " +
      "Lead with the key promise: delivered in 30 minutes, same day. " +
      "Cover: what's available (brands, categories), how same-day delivery works on Sippy, " +
      "coverage zone within {area} and surrounding streets, and a CTA to order now. " +
      "Include a short FAQ (e.g. 'Do you deliver after midnight in {area}?'). " +
      "Tone: fast, confident, locally specific.",
    target_word_count: 600,
    variables: [
      {
        name: "area",
        values: [
          "Lekki Phase 1",
          "Victoria Island",
          "Ikeja GRA",
          "Ikoyi",
          "Surulere",
          "Yaba",
          "Oniru",
          "Chevron",
        ],
      },
    ],
  },
];

async function main() {
  console.log(`\n🌱 Seeding Sippy brand voice and programmatic SEO templates...\n`);

  // ── 1. Upsert brand voice into tenants.settings ──
  const { data: tenant, error: fetchErr } = await admin
    .from("tenants")
    .select("settings")
    .eq("slug", TENANT)
    .maybeSingle();

  if (fetchErr || !tenant) {
    console.error("Could not fetch sippy tenant:", fetchErr?.message ?? "not found");
    process.exit(1);
  }

  const existingSettings = tenant.settings ?? {};
  const newSettings = { ...existingSettings, brand_voice: BRAND_VOICE };

  const { error: updateErr } = await admin
    .from("tenants")
    .update({ settings: newSettings })
    .eq("slug", TENANT);

  if (updateErr) {
    console.error("Failed to update brand voice:", updateErr.message);
    process.exit(1);
  }
  console.log("✅ Brand voice saved to tenants.settings.brand_voice");

  // ── 2. Seed programmatic templates (only if none exist) ──
  const { count } = await admin
    .from("programmatic_templates")
    .select("id", { count: "exact", head: true })
    .eq("tenant_slug", TENANT);

  if (count && count > 0) {
    console.log(
      `⚠️  ${count} template(s) already exist for ${TENANT} — skipping template seed (delete them first to re-seed)`
    );
  } else {
    for (const t of TEMPLATES) {
      const { error: insertErr } = await admin.from("programmatic_templates").insert({
        tenant_slug: TENANT,
        name: t.name,
        title_pattern: t.title_pattern,
        url_pattern: t.url_pattern,
        meta_description_pattern: t.meta_description_pattern,
        content_prompt: t.content_prompt,
        target_word_count: t.target_word_count,
        variables: t.variables,
      });

      if (insertErr) {
        console.error(`❌ Failed to insert template "${t.name}":`, insertErr.message);
      } else {
        const combos = t.variables.reduce((n, v) => n * v.values.length, 1);
        console.log(`✅ Template "${t.name}" — ${combos} pages possible`);
      }
    }
  }

  console.log("\n🎉 Done. Go to Pulse → SEO Tracker → Programmatic to see your templates.");
  console.log("   Go to Settings → Brand Voice to preview and edit the brand voice.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
