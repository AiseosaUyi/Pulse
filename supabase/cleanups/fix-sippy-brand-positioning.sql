-- Sippy's brand_voice / brand_positioning (tenants.settings) were still
-- onboarding placeholder text ("Delivering consistent, valuable insights
-- for Sippy's audience") — never actually filled in for this tenant. Since
-- every AI-drafted DM (draftDm in src/lib/ai/outbound.ts) and other AI
-- copy pulls from these fields, the placeholder text is a big reason
-- AI-generated outreach reads generic instead of like a real drinks
-- supplier. Facts below are pulled from the real Sippy for Business page
-- (Webapp/app/(business)/business/page.tsx + BusinessBody components) —
-- bulk pricing, 14-day invoice terms, one trade account, own inventory +
-- vetted marketplace vendors, city-scoped catalog. Run once in the SQL
-- Editor. Uses jsonb_set (not a plain UPDATE) per this repo's convention
-- for tenants.settings — see CLAUDE.md.

update tenants
set settings = jsonb_set(
  jsonb_set(
    settings,
    '{brand_voice}',
    $voice$
    {
      "tone": "Direct, confident, and helpful — a real drinks supplier talking to a real buyer, not a marketing account. Sound like someone who actually knows the business, not corporate copy.",
      "audience": "Event organizers and planners, plus bars, restaurants, hotels, event centers, stores, offices, and venues in Nigeria that need to stock drinks in bulk or retail quantities.",
      "do_list": [
        "Lead with a concrete value prop: bulk pricing, 14-day invoice terms, one trade account",
        "Be specific about what Sippy supplies and how ordering works",
        "Sound like a helpful salesperson who did their homework, not a mass-blasted template"
      ],
      "dont_list": [
        "Do not use vague filler like great fit or love what you are putting out with no real substance",
        "Do not promise specific pricing, delivery windows, or outcomes that have not been confirmed",
        "Do not sound like an automated or generic outreach bot"
      ],
      "example_posts": [
        "Restock your bar smarter — bulk pricing, 14-day invoice terms, one Sippy trade account for everything.",
        "From your own event to a hotel minibar — Sippy supplies drinks in bulk or retail, delivered."
      ]
    }
    $voice$::jsonb,
    true
  ),
  '{brand_positioning}',
  $positioning$
  {
    "mission": "Make it easy for any business or event in Nigeria — bars, restaurants, hotels, event centers, stores — to stock drinks in bulk without tying up cash or juggling multiple suppliers.",
    "value_proposition": "One Sippy trade account gets you drinks from Sippy's own inventory plus vetted marketplace vendors, at bulk pricing that improves the more you order, with 14-day invoice terms so you can stock now and settle after you have sold.",
    "target_demographics": [
      {
        "segment": "Event organizers and planners",
        "pain_points": [
          "Sourcing drinks from multiple vendors for one event",
          "Paying upfront for stock before ticket or bar revenue comes in",
          "Not knowing what is actually available near their venue"
        ]
      },
      {
        "segment": "Bars, restaurants and hotels",
        "pain_points": [
          "Restocking regularly eats into cash flow",
          "Comparing prices across many small suppliers is slow",
          "No single dedicated account for repeat orders"
        ]
      },
      {
        "segment": "Venues — event centers, gyms, wedding and party spaces",
        "pain_points": [
          "Need drinks in bulk for one-off large gatherings",
          "Limited time to source and compare suppliers before an event date"
        ]
      }
    ],
    "topics_to_cover": [
      "Bulk drink pricing",
      "Trade account and invoice terms",
      "What is in stock in their city",
      "Restocking for bars, restaurants and hotels",
      "Supplying drinks for events"
    ],
    "topics_to_avoid": [],
    "competitors": [],
    "differentiators": [
      "Bulk pricing that improves with order size",
      "14-day invoice terms — order now, settle after",
      "One trade account across Sippy's own inventory and vetted marketplace vendors",
      "City-scoped catalog — see exactly what is available near you"
    ]
  }
  $positioning$::jsonb,
  true
)
where slug = 'sippy';
