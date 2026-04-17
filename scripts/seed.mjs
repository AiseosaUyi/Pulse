// One-time seed: create the founder account + Gruve/Sippy tenants.
// Run: node --env-file=.env.local scripts/seed.mjs
//
// Expects in .env.local:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   SEED_EMAIL, SEED_PASSWORD, SEED_USERNAME (SEED_DISPLAY_NAME optional)

import { createClient } from "@supabase/supabase-js";

const {
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SEED_EMAIL,
  SEED_PASSWORD,
  SEED_USERNAME,
  SEED_DISPLAY_NAME,
} = process.env;

const SUPABASE_URL = NEXT_PUBLIC_SUPABASE_URL;

const missing = [];
if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
if (!SEED_EMAIL) missing.push("SEED_EMAIL");
if (!SEED_PASSWORD) missing.push("SEED_PASSWORD");
if (!SEED_USERNAME) missing.push("SEED_USERNAME");
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TENANTS = [
  {
    slug: "gruve",
    name: "Gruve",
    settings: {
      domain: "gruve.events",
      currency: "NGN",
      audienceConfig: {
        primaryRegions: ["Nigeria"],
        expandedRegions: ["International"],
        targetDemographics: ["18-35", "Event enthusiasts", "Music lovers"],
      },
      platforms: [
        { platform: "instagram", connected: true, handle: "@gruve.events", followers: 4200, engagementRate: 3.2, status: "active" },
        { platform: "tiktok", connected: true, handle: "@gruveevents", followers: 1100, engagementRate: 5.8, status: "needs_posts" },
        { platform: "twitter", connected: true, handle: "@gruve_events", followers: 890, engagementRate: 1.1, status: "low_activity" },
        { platform: "linkedin", connected: true, handle: "Gruve Events", followers: 430, engagementRate: 2.4, status: "active" },
      ],
    },
  },
  {
    slug: "sippy",
    name: "Sippy",
    settings: {
      domain: "sippy.ng",
      currency: "NGN",
      audienceConfig: {
        primaryRegions: ["Lagos", "Abuja", "Calabar"],
        expandedRegions: [],
        targetDemographics: ["21-30", "Nightlife", "Food & Drink"],
      },
      platforms: [
        { platform: "instagram", connected: true, handle: "@sippy.ng", followers: 2800, engagementRate: 4.1, status: "active" },
        { platform: "tiktok", connected: true, handle: "@sippyng", followers: 750, engagementRate: 6.2, status: "active" },
        { platform: "twitter", connected: false, handle: "", followers: 0, engagementRate: 0, status: "inactive" },
        { platform: "linkedin", connected: false, handle: "", followers: 0, engagementRate: 0, status: "inactive" },
      ],
    },
  },
];

const SEED_LEADS = {
  gruve: [
    { name: "Tunde Adeyemi", company: "Muse Events", type: "partner", status: "warm", value: "high", last_contact: "2026-04-08", next_action: "Follow up on co-hosting proposal" },
    { name: "Bola Fashola", company: "GTBank Events", type: "sponsor", status: "contacted", value: "very_high", last_contact: "2026-04-10", next_action: "Awaiting budget approval" },
    { name: "Chidi Nwosu", company: "Eko Atlantic Venues", type: "venue", status: "new", value: "high", last_contact: "2026-04-12", next_action: "Schedule venue walkthrough" },
    { name: "Kemi Alade", company: "BeatFM Lagos", type: "media", status: "warm", value: "medium", last_contact: "2026-04-06", next_action: "Confirm interview slot for next event" },
  ],
  sippy: [
    { name: "Ada Nnamdi", company: "Mixology NG", type: "influencer", status: "contacted", value: "high", last_contact: "2026-04-11", next_action: "Confirm collab on cocktail content" },
    { name: "Grace Ojo", company: "Heineken Nigeria", type: "sponsor", status: "warm", value: "very_high", last_contact: "2026-04-07", next_action: "Send sponsorship proposal" },
    { name: "Femi Johnson", company: "Lagos Eats", type: "media", status: "warm", value: "medium", last_contact: "2026-04-09", next_action: "Arrange tasting session for review" },
  ],
};

const hoursAgo = (n) => new Date(Date.now() - n * 60 * 60 * 1000).toISOString();

const SEED_ENGAGEMENT = {
  gruve: [
    { type: "dm", platform: "instagram", from_name: "Tolu Adeyemi", from_handle: "@tolu_vibes", from_avatar: "👤", content: "Hi! How much are VIP tickets for the April show? Can I get a group discount for 8 people?", received_at: hoursAgo(2), read: false, replied: false, sentiment: "question" },
    { type: "comment", platform: "instagram", from_name: "Chika Okonkwo", from_handle: "@chikaok", from_avatar: "🎵", content: "This lineup is INSANE 🔥🔥 Already got my tickets!", post_title: "Artist lineup announcement", received_at: hoursAgo(3), read: false, replied: false, sentiment: "positive" },
    { type: "mention", platform: "twitter", from_name: "Lagos Events Blog", from_handle: "@lagosevents", from_avatar: "📰", content: "Shoutout to @gruve_events for the best ticketing experience in Lagos. Smooth checkout, instant QR code. This is how it should be done.", received_at: hoursAgo(5), read: true, replied: false, sentiment: "positive" },
    { type: "comment", platform: "tiktok", from_name: "DJ_Melo", from_handle: "@dj_melo_ng", from_avatar: "🎧", content: "The sound check video was fire! When's the next event in Abuja?", post_title: "Behind the scenes: Sound check", received_at: hoursAgo(6), read: true, replied: true, sentiment: "question" },
    { type: "dm", platform: "instagram", from_name: "Party Lagos", from_handle: "@partylagos", from_avatar: "🎉", content: "Would love to collab on promoting each other's events. We have 12K engaged followers in Lagos nightlife.", received_at: hoursAgo(8), read: true, replied: false, sentiment: "positive" },
    { type: "comment", platform: "instagram", from_name: "Bisi Afolabi", from_handle: "@bisi_a", from_avatar: "😤", content: "I bought tickets but never received the confirmation email. This is the second time. Please fix this!", post_title: "Gruve NYE 2025 recap reel", received_at: hoursAgo(10), read: true, replied: true, sentiment: "negative" },
    { type: "mention", platform: "linkedin", from_name: "TechCabal", from_handle: "TechCabal", from_avatar: "💼", content: "Nigerian event ticketing startup @Gruve raises the bar for live experiences in West Africa. Feature coming soon.", received_at: hoursAgo(12), read: true, replied: false, sentiment: "positive" },
    { type: "reply", platform: "twitter", from_name: "Kunle O.", from_handle: "@kunle_o", from_avatar: "🙋", content: "Will there be a livestream option for people outside Lagos? Not everyone can travel!", received_at: hoursAgo(24), read: true, replied: true, sentiment: "question" },
  ],
  sippy: [
    { type: "dm", platform: "instagram", from_name: "Funke Adeoye", from_handle: "@funke_eats", from_avatar: "🍽", content: "Can I book a table for 6 this Saturday? Also, do you have a cocktail menu I can see beforehand?", received_at: hoursAgo(1), read: false, replied: false, sentiment: "question" },
    { type: "comment", platform: "tiktok", from_name: "Lagos Foodie", from_handle: "@lagosfoodie", from_avatar: "🍸", content: "That Sippy Sunset cocktail looks AMAZING. Definitely coming this weekend!", post_title: "Signature cocktail reveal", received_at: hoursAgo(3), read: false, replied: false, sentiment: "positive" },
    { type: "mention", platform: "instagram", from_name: "Time Out Lagos", from_handle: "@timeoutlagos", from_avatar: "📍", content: "New on our radar: @sippy.ng on Victoria Island. The cocktails are creative, the vibe is impeccable. Full review dropping Friday.", received_at: hoursAgo(5), read: true, replied: false, sentiment: "positive" },
    { type: "comment", platform: "instagram", from_name: "Emeka J.", from_handle: "@emeka_j", from_avatar: "😕", content: "Waited 45 minutes for a table last Friday with a reservation. Please sort out the wait times.", post_title: "Saturday launch party highlights", received_at: hoursAgo(8), read: true, replied: true, sentiment: "negative" },
    { type: "dm", platform: "instagram", from_name: "Heineken Nigeria", from_handle: "@heineken_ng", from_avatar: "🍺", content: "Following up on the sponsorship proposal. Our brand team reviewed it and we'd like to discuss terms. When are you available?", received_at: hoursAgo(24), read: true, replied: false, sentiment: "positive" },
  ],
};

const SEED_KEYWORDS = {
  gruve: [
    { keyword: "event ticketing Nigeria", position: 11, previous_position: 15, volume: 2400, difficulty: "medium", url: "/events", last_checked: "2026-04-15" },
    { keyword: "buy event tickets Lagos", position: 8, previous_position: 9, volume: 1800, difficulty: "medium", url: "/events/lagos", last_checked: "2026-04-15" },
    { keyword: "Gruve events", position: 1, previous_position: 1, volume: 890, difficulty: "easy", url: "/", last_checked: "2026-04-15" },
    { keyword: "live music events Lagos", position: 18, previous_position: 22, volume: 3200, difficulty: "hard", url: "/events/music", last_checked: "2026-04-15" },
    { keyword: "event ticketing platform Africa", position: 14, previous_position: 19, volume: 1200, difficulty: "hard", url: "/", last_checked: "2026-04-15" },
    { keyword: "concert tickets Nigeria", position: 23, previous_position: 28, volume: 4100, difficulty: "hard", url: "/events/concerts", last_checked: "2026-04-15" },
    { keyword: "weekend events near me", position: 31, previous_position: 35, volume: 8900, difficulty: "hard", url: "/events", last_checked: "2026-04-15" },
  ],
  sippy: [
    { keyword: "best bars Lagos", position: 15, previous_position: 22, volume: 5400, difficulty: "hard", url: "/", last_checked: "2026-04-15" },
    { keyword: "cocktail bar Lagos", position: 9, previous_position: 12, volume: 2200, difficulty: "medium", url: "/", last_checked: "2026-04-15" },
    { keyword: "Sippy Lagos", position: 1, previous_position: 1, volume: 320, difficulty: "easy", url: "/", last_checked: "2026-04-15" },
    { keyword: "nightlife Lagos Island", position: 19, previous_position: 25, volume: 3800, difficulty: "hard", url: "/events", last_checked: "2026-04-15" },
    { keyword: "best cocktails Calabar", position: 5, previous_position: 8, volume: 480, difficulty: "easy", url: "/calabar", last_checked: "2026-04-15" },
  ],
};

const SEED_COMPETITORS = {
  gruve: [
    {
      name: "Tix Africa",
      website: "tix.africa",
      type: "direct",
      threat_level: "high",
      strengths: ["Established brand", "Multi-city presence", "Developer API"],
      weaknesses: ["Generic positioning", "Low social engagement", "No TikTok presence"],
      platforms: [
        { platform: "instagram", handle: "@tixafrica", followers: 15200, engagementRate: "2.8%", lastChecked: "2026-04-15" },
        { platform: "twitter", handle: "@tixafrica", followers: 8900, engagementRate: "1.5%", lastChecked: "2026-04-15" },
      ],
    },
    {
      name: "Eventbrite NG",
      website: "eventbrite.com",
      type: "aspirational",
      threat_level: "medium",
      strengths: ["Global brand recognition", "Enterprise features", "SEO dominance"],
      weaknesses: ["Not Nigeria-focused", "High fees", "Poor local support"],
      platforms: [
        { platform: "instagram", handle: "@eventbrite", followers: 45000, engagementRate: "0.8%", lastChecked: "2026-04-15" },
        { platform: "twitter", handle: "@eventbrite", followers: 32000, engagementRate: "0.4%", lastChecked: "2026-04-15" },
      ],
    },
    {
      name: "Nairabox",
      website: "nairabox.com",
      type: "direct",
      threat_level: "high",
      strengths: ["Strong local brand", "Good mobile experience", "Naira-first pricing"],
      weaknesses: ["Limited event types", "Small team", "No LinkedIn presence"],
      platforms: [
        { platform: "instagram", handle: "@nairabox", followers: 8400, engagementRate: "3.1%", lastChecked: "2026-04-15" },
        { platform: "tiktok", handle: "@nairabox", followers: 2100, engagementRate: "5.2%", lastChecked: "2026-04-15" },
      ],
    },
  ],
  sippy: [
    {
      name: "Bukka Hut",
      website: "bukkahut.com",
      type: "adjacent",
      threat_level: "low",
      strengths: ["Multiple locations", "Strong brand", "Food delivery integration"],
      weaknesses: ["Not nightlife-focused", "Low social engagement"],
      platforms: [
        { platform: "instagram", handle: "@bukkahut", followers: 28000, engagementRate: "2.2%", lastChecked: "2026-04-15" },
      ],
    },
    {
      name: "Hard Rock Lagos",
      website: "hardrockcafe.com",
      type: "aspirational",
      threat_level: "medium",
      strengths: ["International brand", "Premium positioning", "Live music"],
      weaknesses: ["High prices", "Tourist-heavy", "Not community-driven"],
      platforms: [
        { platform: "instagram", handle: "@hardrocklagos", followers: 12000, engagementRate: "1.8%", lastChecked: "2026-04-15" },
      ],
    },
    {
      name: "Sky Lounge",
      website: "skyloungelagos.com",
      type: "direct",
      threat_level: "high",
      strengths: ["Strong social game", "Young audience", "Viral content"],
      weaknesses: ["Single location", "Weekend-only traffic"],
      platforms: [
        { platform: "instagram", handle: "@skyloungelagos", followers: 9800, engagementRate: "4.5%", lastChecked: "2026-04-15" },
        { platform: "tiktok", handle: "@skyloungelagos", followers: 3200, engagementRate: "7.1%", lastChecked: "2026-04-15" },
      ],
    },
  ],
};

const SEED_CAMPAIGNS = {
  gruve: [
    { name: "Gruve Live April — Awareness", platform: "instagram", status: "paused", spend: 35000, revenue: 178000, impressions: 45200, clicks: 1230, conversions: 89, start_date: "2026-03-15", end_date: "2026-04-01" },
    { name: "Ticket Sales Push", platform: "instagram", status: "paused", spend: 22000, revenue: 312000, impressions: 28400, clicks: 890, conversions: 156, start_date: "2026-03-25", end_date: "2026-04-05" },
    { name: "TikTok Event Teaser", platform: "tiktok", status: "completed", spend: 15000, revenue: 67500, impressions: 62000, clicks: 2100, conversions: 45, start_date: "2026-03-10", end_date: "2026-03-30" },
  ],
  sippy: [
    { name: "Grand Opening Awareness", platform: "instagram", status: "active", spend: 25000, revenue: 85000, impressions: 38000, clicks: 1450, conversions: 210, start_date: "2026-04-05", end_date: "2026-04-20" },
    { name: "Cocktail Hour Promo", platform: "instagram", status: "active", spend: 20000, revenue: 42000, impressions: 22000, clicks: 980, conversions: 85, start_date: "2026-04-08", end_date: "2026-04-22" },
    { name: "Weekend Vibes TikTok", platform: "tiktok", status: "draft", spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0, start_date: "2026-04-15", end_date: "2026-04-30" },
  ],
};

const SEED_POSTS = {
  gruve: [
    { title: "Gruve NYE 2025 recap reel", platform: "instagram", content_type: "video", posted_at: "2026-04-07", reach: 4200, impressions: 5800, likes: 342, comments: 28, shares: 45, saves: 67 },
    { title: "Behind the scenes: Sound check", platform: "tiktok", content_type: "video", posted_at: "2026-04-05", reach: 2800, impressions: 4100, likes: 289, comments: 31, shares: 52, saves: 0 },
    { title: "Artist lineup announcement", platform: "instagram", content_type: "carousel", posted_at: "2026-04-03", reach: 3100, impressions: 4500, likes: 198, comments: 42, shares: 23, saves: 89 },
    { title: "Ticket giveaway thread", platform: "twitter", content_type: "text", posted_at: "2026-04-01", reach: 1900, impressions: 2800, likes: 67, comments: 34, shares: 89, saves: 0 },
    { title: "Early bird reminder story", platform: "instagram", content_type: "image", posted_at: "2026-03-30", reach: 1200, impressions: 1800, likes: 89, comments: 5, shares: 3, saves: 12 },
    { title: "Community spotlight: DJ set", platform: "instagram", content_type: "video", posted_at: "2026-03-26", reach: 2400, impressions: 3200, likes: 234, comments: 15, shares: 32, saves: 41 },
  ],
  sippy: [
    { title: "Saturday launch party highlights", platform: "instagram", content_type: "video", posted_at: "2026-04-12", reach: 3800, impressions: 5200, likes: 412, comments: 38, shares: 56, saves: 78 },
    { title: "Signature cocktail reveal", platform: "tiktok", content_type: "video", posted_at: "2026-04-10", reach: 12000, impressions: 18500, likes: 1450, comments: 89, shares: 234, saves: 0 },
    { title: "Venue tour walkthrough", platform: "instagram", content_type: "carousel", posted_at: "2026-04-08", reach: 2100, impressions: 3200, likes: 167, comments: 22, shares: 15, saves: 45 },
    { title: "Menu spotlight: Drink of the week", platform: "instagram", content_type: "image", posted_at: "2026-04-05", reach: 1400, impressions: 2100, likes: 98, comments: 12, shares: 8, saves: 34 },
  ],
};

async function findOrCreateUser() {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const existing = data.users.find(
    (u) => u.email?.toLowerCase() === SEED_EMAIL.toLowerCase()
  );
  if (existing) {
    console.log(`user:  ${SEED_EMAIL} (exists)`);
    return existing;
  }
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: SEED_EMAIL,
    password: SEED_PASSWORD,
    email_confirm: true,
    user_metadata: {
      username: SEED_USERNAME,
      display_name: SEED_DISPLAY_NAME ?? SEED_USERNAME,
    },
  });
  if (createErr) throw createErr;
  console.log(`user:  ${SEED_EMAIL} (created)`);
  return created.user;
}

async function ensureProfile(user) {
  const { error } = await admin.from("profiles").upsert({
    id: user.id,
    username: SEED_USERNAME,
    display_name: SEED_DISPLAY_NAME ?? SEED_USERNAME,
  });
  if (error) throw error;
  console.log(`prof:  ${SEED_USERNAME}`);
}

async function ensureTenantsAndMemberships(user) {
  for (const t of TENANTS) {
    const { error: tErr } = await admin.from("tenants").upsert({
      slug: t.slug,
      name: t.name,
      settings: t.settings,
      created_by: user.id,
    });
    if (tErr) throw tErr;

    const { error: mErr } = await admin.from("memberships").upsert({
      user_id: user.id,
      tenant_slug: t.slug,
      role: "owner",
    });
    if (mErr) throw mErr;

    console.log(`team:  ${t.slug} (owner)`);
  }
}

async function ensureLeads(user) {
  for (const t of TENANTS) {
    const { data: existing, error: readErr } = await admin
      .from("leads")
      .select("id")
      .eq("tenant_slug", t.slug)
      .limit(1);
    if (readErr) throw readErr;
    if (existing && existing.length > 0) {
      console.log(`lead:  ${t.slug} (exists)`);
      continue;
    }

    const rows = SEED_LEADS[t.slug].map((l) => ({
      ...l,
      tenant_slug: t.slug,
      created_by: user.id,
    }));
    const { error } = await admin.from("leads").insert(rows);
    if (error) throw error;
    console.log(`lead:  ${t.slug} (${rows.length} seeded)`);
  }
}

async function ensurePosts(user) {
  for (const t of TENANTS) {
    const { data: existing, error: readErr } = await admin
      .from("posts")
      .select("id")
      .eq("tenant_slug", t.slug)
      .limit(1);
    if (readErr) throw readErr;
    if (existing && existing.length > 0) {
      console.log(`post:  ${t.slug} (exists)`);
      continue;
    }

    const rows = SEED_POSTS[t.slug].map((p) => ({
      ...p,
      tenant_slug: t.slug,
      created_by: user.id,
    }));
    const { error } = await admin.from("posts").insert(rows);
    if (error) throw error;
    console.log(`post:  ${t.slug} (${rows.length} seeded)`);
  }
}

async function ensureCampaigns(user) {
  for (const t of TENANTS) {
    const { data: existing, error: readErr } = await admin
      .from("campaigns")
      .select("id")
      .eq("tenant_slug", t.slug)
      .limit(1);
    if (readErr) throw readErr;
    if (existing && existing.length > 0) {
      console.log(`camp:  ${t.slug} (exists)`);
      continue;
    }

    const rows = SEED_CAMPAIGNS[t.slug].map((c) => ({
      ...c,
      tenant_slug: t.slug,
      created_by: user.id,
    }));
    const { error } = await admin.from("campaigns").insert(rows);
    if (error) throw error;
    console.log(`camp:  ${t.slug} (${rows.length} seeded)`);
  }
}

async function ensureCompetitors() {
  for (const t of TENANTS) {
    const { data: existing, error: readErr } = await admin
      .from("competitors")
      .select("id")
      .eq("tenant_id", t.slug)
      .limit(1);
    if (readErr) throw readErr;
    if (existing && existing.length > 0) {
      console.log(`comp:  ${t.slug} (exists)`);
      continue;
    }

    const rows = SEED_COMPETITORS[t.slug].map((c) => ({
      ...c,
      tenant_id: t.slug,
    }));
    const { error } = await admin.from("competitors").insert(rows);
    if (error) throw error;
    console.log(`comp:  ${t.slug} (${rows.length} seeded)`);
  }
}

async function ensureKeywords(user) {
  for (const t of TENANTS) {
    const { data: existing, error: readErr } = await admin
      .from("keyword_rankings")
      .select("id")
      .eq("tenant_slug", t.slug)
      .limit(1);
    if (readErr) throw readErr;
    if (existing && existing.length > 0) {
      console.log(`kw:    ${t.slug} (exists)`);
      continue;
    }

    const rows = SEED_KEYWORDS[t.slug].map((k) => ({
      ...k,
      tenant_slug: t.slug,
      created_by: user.id,
    }));
    const { error } = await admin.from("keyword_rankings").insert(rows);
    if (error) throw error;
    console.log(`kw:    ${t.slug} (${rows.length} seeded)`);
  }
}

async function ensureEngagement(user) {
  for (const t of TENANTS) {
    const { data: existing, error: readErr } = await admin
      .from("engagement_items")
      .select("id")
      .eq("tenant_slug", t.slug)
      .limit(1);
    if (readErr) throw readErr;
    if (existing && existing.length > 0) {
      console.log(`eng:   ${t.slug} (exists)`);
      continue;
    }

    const rows = SEED_ENGAGEMENT[t.slug].map((e) => ({
      ...e,
      tenant_slug: t.slug,
      created_by: user.id,
    }));
    const { error } = await admin.from("engagement_items").insert(rows);
    if (error) throw error;
    console.log(`eng:   ${t.slug} (${rows.length} seeded)`);
  }
}

const SEED_INTEL_CARDS = {
  gruve: [
    { competitor_name: "Sofar Sounds", competitor_type: "aspirational", platform: "tiktok", content_type: "reel", summary: "\"What if secret concerts were a thing?\" teaser format. 15-second clip, faces blurred, location hidden. Comment section is 90% \"WHERE IS THIS\" — deliberate mystery marketing.", metrics: { views: 340000, likes: 41200, engagement: 41200, engagementRate: 12.1, shares: 1800, comments: 4200, vsAverage: 3.2 }, ai_recommendation: { impact: "high", urgency: "opportunity", analysis: "Mystery/teaser format is dominating event TikTok right now. Sofar Sounds isn't in Nigeria but the format translates perfectly to Lagos event culture.", action: "For your next Gruve event: shoot a 15-sec teaser, hide the venue, let the comments drive FOMO.", contentBriefReady: true }, detected_at: "2026-04-13T10:30:00Z", source: "manual" },
    { competitor_name: "Tix Africa", competitor_type: "direct", platform: "blog", content_type: "blog", summary: "Published a 2,400-word guide: \"Best Outdoor Events in Lagos 2026\" targeting [lagos events, outdoor parties lagos, things to do in lagos]. Already ranking position 14.", metrics: { views: 1200, engagement: 89, engagementRate: 7.4, comments: 12, vsAverage: null }, ai_recommendation: { impact: "high", urgency: "urgent", analysis: "Tix Africa is claiming the \"lagos events\" keyword cluster. Gruve has stronger event data but hasn't published SEO content yet.", action: "Publish a competing guide within 7 days before their page ages into the top 10.", contentBriefReady: true }, detected_at: "2026-04-14T08:00:00Z", source: "manual" },
    { competitor_name: "Nairabox", competitor_type: "direct", platform: "instagram", content_type: "reel", summary: "BTS reel from a Lagos rooftop party. Shot on iPhone, lo-fi edit with afrobeats soundtrack. Caption: \"When the sunset hits different at 2,000ft...\" No hard sell, pure vibes.", metrics: { views: 23400, likes: 1920, engagement: 1920, engagementRate: 8.2, shares: 412, comments: 89, vsAverage: 3.2 }, ai_recommendation: { impact: "high", urgency: "opportunity", analysis: "BTS reels with lo-fi edit + location flex are outperforming polished content 3.2x for Lagos event brands this week.", action: "Shoot a similar BTS reel at your next venue walkthrough.", contentBriefReady: true }, detected_at: "2026-04-15T06:00:00Z", source: "manual" },
    { competitor_name: "Nairabox", competitor_type: "direct", platform: "twitter", content_type: "thread", summary: "Thread on \"How we sold out 500 tickets in 48 hours\" — breakdown of their marketing funnel. Got 200+ retweets.", metrics: { views: 45000, engagement: 2800, engagementRate: 6.2, shares: 210, comments: 95, vsAverage: 2.1 }, ai_recommendation: { impact: "medium", urgency: "fyi", analysis: "Nairabox is sharing playbook content publicly. Good engagement but it's also giving away their strategy.", action: "Consider creating your own \"how we did it\" thread for Gruve.", contentBriefReady: false }, detected_at: "2026-04-12T14:00:00Z", source: "manual" },
    { competitor_name: "Tix Africa", competitor_type: "direct", platform: "linkedin", content_type: "post", summary: "Announced partnership with a major Nigerian bank for event payment processing. Professional post with corporate language.", metrics: { views: 3200, engagement: 180, engagementRate: 5.6, comments: 24, vsAverage: 1.5 }, ai_recommendation: { impact: "medium", urgency: "fyi", analysis: "Tix Africa is building institutional partnerships. This won't affect social marketing directly but strengthens their enterprise positioning.", action: "No immediate action needed. Monitor for follow-up announcements.", contentBriefReady: false }, detected_at: "2026-04-11T09:00:00Z", source: "manual" },
  ],
  sippy: [
    { competitor_name: "Sky Lounge", competitor_type: "direct", platform: "tiktok", content_type: "reel", summary: "\"POV: You just found Lagos's best-kept secret\" — 30-second venue tour with trending audio. Dramatic reveal of rooftop view. 90% of comments asking for location.", metrics: { views: 128000, likes: 15600, engagement: 15600, engagementRate: 12.2, shares: 3400, comments: 890, vsAverage: 4.1 }, ai_recommendation: { impact: "high", urgency: "urgent", analysis: "Sky Lounge is dominating Lagos nightlife TikTok with venue reveal content. Their engagement rate is 4x their average.", action: "Shoot a \"best-kept secret\" venue reveal for Sippy within 3 days.", contentBriefReady: true }, detected_at: "2026-04-14T20:00:00Z", source: "manual" },
    { competitor_name: "Drinks.ng", competitor_type: "aspirational", platform: "instagram", content_type: "reel", summary: "\"Making the perfect Lagos sunset cocktail\" recipe reel. Clean overhead shot, ASMR-style sound design, ingredient callouts.", metrics: { views: 67000, likes: 5800, engagement: 5800, engagementRate: 8.7, shares: 1200, comments: 340, vsAverage: 2.8 }, ai_recommendation: { impact: "high", urgency: "opportunity", analysis: "Recipe/cocktail-making reels consistently outperform static drink photos for Lagos food & drink brands.", action: "Start a weekly \"Sippy Signature\" recipe reel series.", contentBriefReady: true }, detected_at: "2026-04-15T08:00:00Z", source: "manual" },
    { competitor_name: "Sky Lounge", competitor_type: "direct", platform: "instagram", content_type: "story", summary: "Instagram Story poll: \"Friday or Saturday for our next DJ set?\" — 8,400 votes, 62/38 split. Used result to announce the event the next day.", metrics: { views: 12000, engagement: 8400, engagementRate: 70.0, vsAverage: 5.2 }, ai_recommendation: { impact: "medium", urgency: "opportunity", analysis: "Interactive stories (polls, questions, countdowns) get 5x the engagement of passive stories for nightlife brands.", action: "Run a poll on Sippy's IG stories this week.", contentBriefReady: false }, detected_at: "2026-04-13T16:00:00Z", source: "manual" },
    { competitor_name: "Hard Rock Lagos", competitor_type: "adjacent", platform: "instagram", content_type: "post", summary: "Photo carousel of their new cocktail menu with lifestyle shots. Professional photography but feels corporate.", metrics: { views: 4500, likes: 320, engagement: 320, engagementRate: 2.7, comments: 18, vsAverage: 0.8 }, ai_recommendation: { impact: "low", urgency: "fyi", analysis: "Hard Rock's polished corporate content is underperforming. Their audience wants authenticity.", action: "No action needed. This confirms your lo-fi strategy is right for Lagos.", contentBriefReady: false }, detected_at: "2026-04-12T11:00:00Z", source: "manual" },
  ],
};

async function ensureIntelCards() {
  for (const t of TENANTS) {
    const { data: existing, error: readErr } = await admin
      .from("intel_cards")
      .select("id")
      .eq("tenant_id", t.slug)
      .limit(1);
    if (readErr) throw readErr;
    if (existing && existing.length > 0) {
      console.log(`intel: ${t.slug} (exists)`);
      continue;
    }

    const { data: comps, error: cErr } = await admin
      .from("competitors")
      .select("id, name")
      .eq("tenant_id", t.slug);
    if (cErr) throw cErr;
    const byName = new Map(comps?.map((c) => [c.name, c.id]) ?? []);

    const skipped = [];
    const rows = SEED_INTEL_CARDS[t.slug]
      .map((card) => {
        const cid = byName.get(card.competitor_name);
        if (!cid) {
          skipped.push(card.competitor_name);
          return null;
        }
        return {
          tenant_id: t.slug,
          competitor_id: cid,
          competitor_name: card.competitor_name,
          competitor_type: card.competitor_type,
          platform: card.platform,
          content_type: card.content_type,
          summary: card.summary,
          metrics: card.metrics,
          ai_recommendation: card.ai_recommendation,
          detected_at: card.detected_at,
          source: card.source,
        };
      })
      .filter(Boolean);
    if (skipped.length) console.log(`intel: ${t.slug} skipped (no competitor): ${skipped.join(", ")}`);
    if (rows.length === 0) {
      console.log(`intel: ${t.slug} (no mappable rows)`);
      continue;
    }
    const { error } = await admin.from("intel_cards").insert(rows);
    if (error) throw error;
    console.log(`intel: ${t.slug} (${rows.length} seeded)`);
  }
}

async function main() {
  const user = await findOrCreateUser();
  await ensureProfile(user);
  await ensureTenantsAndMemberships(user);
  await ensureLeads(user);
  await ensurePosts(user);
  await ensureCampaigns(user);
  await ensureCompetitors();
  await ensureKeywords(user);
  await ensureEngagement(user);
  await ensureIntelCards();
  console.log("\ndone. login with SEED_EMAIL + SEED_PASSWORD.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
