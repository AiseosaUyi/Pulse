import type {
  SEOMetric, KeywordRanking, KeywordGroup, TopicalCluster,
  InternalLink, BlogPost, ContentScoreBreakdown, ProgrammaticTemplate,
  SERPAnalysis,
} from "@/lib/types/seo";

// ─── SEO Metrics ──────────────────────────────────────────────

export const mockSEOMetrics: Record<string, SEOMetric[]> = {
  gruve: [
    { label: "Domain Authority", value: "28", change: "+3", direction: "up" },
    { label: "Indexed Pages", value: "142", change: "+12", direction: "up" },
    { label: "Backlinks", value: "89", change: "+7", direction: "up" },
    { label: "Avg. Position", value: "15.1", change: "-2.4", direction: "up" },
    { label: "Organic Traffic", value: "2.1K", change: "+18%", direction: "up" },
    { label: "Content Score Avg", value: "68", change: "+5", direction: "up" },
    { label: "Coverage Gaps", value: "12", change: "-3", direction: "up" },
    { label: "Top 3 Keywords", value: "3", change: "+1", direction: "up" },
  ],
  sippy: [
    { label: "Domain Authority", value: "18", change: "+5", direction: "up" },
    { label: "Indexed Pages", value: "34", change: "+8", direction: "up" },
    { label: "Backlinks", value: "23", change: "+11", direction: "up" },
    { label: "Avg. Position", value: "9.8", change: "-3.2", direction: "up" },
    { label: "Organic Traffic", value: "680", change: "+32%", direction: "up" },
    { label: "Content Score Avg", value: "74", change: "+8", direction: "up" },
    { label: "Coverage Gaps", value: "8", change: "-2", direction: "up" },
    { label: "Top 3 Keywords", value: "2", change: "+1", direction: "up" },
  ],
};

// ─── Keyword Rankings ─────────────────────────────────────────

export const mockKeywordRankings: Record<string, KeywordRanking[]> = {
  gruve: [
    { keyword: "event ticketing Nigeria", position: 11, previousPosition: 15, volume: 2400, difficulty: "medium", url: "/events" },
    { keyword: "buy event tickets Lagos", position: 8, previousPosition: 9, volume: 1800, difficulty: "medium", url: "/events/lagos" },
    { keyword: "Gruve events", position: 1, previousPosition: 1, volume: 890, difficulty: "easy", url: "/" },
    { keyword: "live music events Lagos", position: 18, previousPosition: 22, volume: 3200, difficulty: "hard", url: "/events/music" },
    { keyword: "event ticketing platform Africa", position: 14, previousPosition: 19, volume: 1200, difficulty: "hard", url: "/" },
  ],
  sippy: [
    { keyword: "best bars Lagos", position: 15, previousPosition: 22, volume: 5400, difficulty: "hard", url: "/" },
    { keyword: "cocktail bar Lagos", position: 9, previousPosition: 12, volume: 2200, difficulty: "medium", url: "/" },
    { keyword: "Sippy Lagos", position: 1, previousPosition: 1, volume: 320, difficulty: "easy", url: "/" },
    { keyword: "nightlife Lagos Island", position: 19, previousPosition: 25, volume: 3800, difficulty: "hard", url: "/events" },
    { keyword: "best cocktails Calabar", position: 5, previousPosition: 8, volume: 480, difficulty: "easy", url: "/calabar" },
  ],
};

// ─── Keyword Research ─────────────────────────────────────────

export const mockKeywordGroups: Record<string, KeywordGroup[]> = {
  gruve: [
    {
      id: "kg1", name: "Event Ticketing (Core)", avgVolume: 2100, avgDifficulty: "medium", dominantIntent: "transactional",
      keywords: [
        { id: "k1", keyword: "buy event tickets online Nigeria", volume: 2400, difficulty: "medium", cpc: 45, intent: "transactional", trend: "rising", parentTopic: "Event Ticketing", isLongTail: false, serpFeatures: ["local_pack", "faq"], source: "ai_discovered" },
        { id: "k2", keyword: "event tickets Lagos cheap", volume: 1800, difficulty: "medium", cpc: 38, intent: "transactional", trend: "stable", parentTopic: "Event Ticketing", isLongTail: true, serpFeatures: ["faq"], source: "ai_discovered" },
        { id: "k3", keyword: "online ticketing platform Nigeria", volume: 1200, difficulty: "hard", cpc: 62, intent: "commercial", trend: "rising", parentTopic: "Event Ticketing", isLongTail: false, serpFeatures: ["featured_snippet"], source: "competitor" },
        { id: "k4", keyword: "how to sell event tickets online", volume: 980, difficulty: "easy", cpc: 28, intent: "informational", trend: "stable", parentTopic: "Event Ticketing", isLongTail: true, serpFeatures: ["featured_snippet", "video"], source: "ai_discovered" },
        { id: "k5", keyword: "event registration platform Africa", volume: 650, difficulty: "medium", cpc: 55, intent: "commercial", trend: "rising", parentTopic: "Event Ticketing", isLongTail: false, serpFeatures: [], source: "ai_discovered" },
      ],
    },
    {
      id: "kg2", name: "Live Music & Concerts", avgVolume: 3400, avgDifficulty: "hard", dominantIntent: "informational",
      keywords: [
        { id: "k6", keyword: "live music events Lagos 2026", volume: 4200, difficulty: "hard", cpc: 22, intent: "informational", trend: "rising", parentTopic: "Live Music", isLongTail: false, serpFeatures: ["local_pack", "video"], source: "ai_discovered" },
        { id: "k7", keyword: "concerts in Lagos this weekend", volume: 5800, difficulty: "hard", cpc: 18, intent: "transactional", trend: "rising", parentTopic: "Live Music", isLongTail: true, serpFeatures: ["local_pack"], source: "ai_discovered" },
        { id: "k8", keyword: "Afrobeats live show tickets", volume: 2200, difficulty: "medium", cpc: 35, intent: "transactional", trend: "rising", parentTopic: "Live Music", isLongTail: true, serpFeatures: ["video"], source: "competitor" },
        { id: "k9", keyword: "best live music venues Lagos", volume: 1800, difficulty: "medium", cpc: 15, intent: "informational", trend: "stable", parentTopic: "Live Music", isLongTail: false, serpFeatures: ["local_pack", "faq"], source: "ai_discovered" },
      ],
    },
    {
      id: "kg3", name: "Event Planning", avgVolume: 1600, avgDifficulty: "easy", dominantIntent: "informational",
      keywords: [
        { id: "k10", keyword: "how to organize an event in Nigeria", volume: 2400, difficulty: "easy", cpc: 12, intent: "informational", trend: "stable", parentTopic: "Event Planning", isLongTail: true, serpFeatures: ["featured_snippet", "faq"], source: "ai_discovered" },
        { id: "k11", keyword: "event planning checklist", volume: 3200, difficulty: "medium", cpc: 8, intent: "informational", trend: "stable", parentTopic: "Event Planning", isLongTail: false, serpFeatures: ["featured_snippet"], source: "ai_discovered" },
        { id: "k12", keyword: "event promotion strategies Nigeria", volume: 890, difficulty: "easy", cpc: 18, intent: "informational", trend: "rising", parentTopic: "Event Planning", isLongTail: true, serpFeatures: [], source: "ai_discovered" },
      ],
    },
    {
      id: "kg4", name: "Brand Searches", avgVolume: 600, avgDifficulty: "easy", dominantIntent: "navigational",
      keywords: [
        { id: "k13", keyword: "Gruve events", volume: 890, difficulty: "easy", cpc: 5, intent: "navigational", trend: "rising", parentTopic: "Brand", isLongTail: false, serpFeatures: [], source: "manual" },
        { id: "k14", keyword: "Gruve tickets login", volume: 340, difficulty: "easy", cpc: 3, intent: "navigational", trend: "stable", parentTopic: "Brand", isLongTail: true, serpFeatures: [], source: "manual" },
        { id: "k15", keyword: "Gruve app download", volume: 220, difficulty: "easy", cpc: 8, intent: "navigational", trend: "rising", parentTopic: "Brand", isLongTail: true, serpFeatures: [], source: "manual" },
      ],
    },
  ],
  sippy: [
    {
      id: "kg5", name: "Bars & Nightlife (Core)", avgVolume: 3800, avgDifficulty: "hard", dominantIntent: "informational",
      keywords: [
        { id: "k16", keyword: "best bars in Lagos", volume: 5400, difficulty: "hard", cpc: 28, intent: "informational", trend: "rising", parentTopic: "Lagos Bars", isLongTail: false, serpFeatures: ["local_pack", "faq"], source: "ai_discovered" },
        { id: "k17", keyword: "cocktail bars Victoria Island", volume: 2200, difficulty: "medium", cpc: 22, intent: "informational", trend: "rising", parentTopic: "Lagos Bars", isLongTail: true, serpFeatures: ["local_pack"], source: "ai_discovered" },
        { id: "k18", keyword: "rooftop bars Lagos", volume: 3100, difficulty: "hard", cpc: 25, intent: "informational", trend: "rising", parentTopic: "Lagos Bars", isLongTail: false, serpFeatures: ["local_pack", "video"], source: "competitor" },
        { id: "k19", keyword: "nightlife guide Lagos 2026", volume: 1800, difficulty: "medium", cpc: 15, intent: "informational", trend: "rising", parentTopic: "Lagos Bars", isLongTail: true, serpFeatures: ["featured_snippet"], source: "ai_discovered" },
      ],
    },
    {
      id: "kg6", name: "Cocktails & Drinks", avgVolume: 1200, avgDifficulty: "easy", dominantIntent: "informational",
      keywords: [
        { id: "k20", keyword: "best cocktails in Lagos", volume: 1600, difficulty: "easy", cpc: 12, intent: "informational", trend: "stable", parentTopic: "Cocktails", isLongTail: false, serpFeatures: ["faq", "video"], source: "ai_discovered" },
        { id: "k21", keyword: "signature cocktail recipes Nigerian bars", volume: 480, difficulty: "easy", cpc: 8, intent: "informational", trend: "rising", parentTopic: "Cocktails", isLongTail: true, serpFeatures: ["video"], source: "ai_discovered" },
        { id: "k22", keyword: "happy hour deals Lagos", volume: 2100, difficulty: "medium", cpc: 18, intent: "transactional", trend: "rising", parentTopic: "Cocktails", isLongTail: true, serpFeatures: ["local_pack"], source: "ai_discovered" },
      ],
    },
  ],
};

// ─── Topical Clusters ─────────────────────────────────────────

export const mockTopicalClusters: Record<string, TopicalCluster[]> = {
  gruve: [
    {
      id: "tc1", pillarTopic: "Event Ticketing in Nigeria", pillarUrl: "/blog/event-ticketing-nigeria", pillarStatus: "published",
      totalVolume: 12400, coverageScore: 72,
      supportingArticles: [
        { id: "sa1", title: "How to Buy Event Tickets Online in Nigeria", slug: "/blog/buy-tickets-online-nigeria", status: "published", targetKeyword: "buy event tickets online Nigeria", volume: 2400, position: 8, linkedToPillar: true, contentScore: 82 },
        { id: "sa2", title: "Top 10 Event Ticketing Platforms Compared", slug: "/blog/ticketing-platforms-compared", status: "published", targetKeyword: "event ticketing platform Nigeria", volume: 1200, position: 14, linkedToPillar: true, contentScore: 71 },
        { id: "sa3", title: "Event Ticket Pricing Guide for Organizers", slug: "/blog/ticket-pricing-guide", status: "draft", targetKeyword: "how to price event tickets", volume: 890, position: null, linkedToPillar: false, contentScore: 58 },
        { id: "sa4", title: "Free vs Paid Ticketing Platforms", slug: null, status: "planned", targetKeyword: "free event ticketing Nigeria", volume: 650, position: null, linkedToPillar: false, contentScore: null },
        { id: "sa5", title: "How to Sell Out Your Event in 48 Hours", slug: null, status: "gap", targetKeyword: "sell out event fast", volume: 1400, position: null, linkedToPillar: false, contentScore: null },
      ],
      internalLinks: [
        { id: "il1", sourceUrl: "/blog/buy-tickets-online-nigeria", sourceTitle: "How to Buy Event Tickets Online", targetUrl: "/blog/event-ticketing-nigeria", targetTitle: "Event Ticketing in Nigeria", anchorText: "event ticketing guide", status: "active", linkEquity: "high" },
        { id: "il2", sourceUrl: "/blog/ticketing-platforms-compared", sourceTitle: "Ticketing Platforms Compared", targetUrl: "/blog/buy-tickets-online-nigeria", targetTitle: "How to Buy Tickets", anchorText: "buy tickets online", status: "active", linkEquity: "medium" },
        { id: "il3", sourceUrl: "/blog/event-ticketing-nigeria", sourceTitle: "Event Ticketing in Nigeria", targetUrl: "/blog/ticket-pricing-guide", targetTitle: "Ticket Pricing Guide", anchorText: "pricing your tickets", status: "suggested", linkEquity: "high" },
      ],
    },
    {
      id: "tc2", pillarTopic: "Live Music Events Lagos", pillarUrl: "/blog/live-music-lagos", pillarStatus: "published",
      totalVolume: 8200, coverageScore: 55,
      supportingArticles: [
        { id: "sa6", title: "Best Live Music Venues in Lagos 2026", slug: "/blog/best-venues-lagos", status: "published", targetKeyword: "best live music venues Lagos", volume: 1800, position: 12, linkedToPillar: true, contentScore: 76 },
        { id: "sa7", title: "Afrobeats Live: What to Expect", slug: "/blog/afrobeats-live-guide", status: "draft", targetKeyword: "Afrobeats live show", volume: 2200, position: null, linkedToPillar: false, contentScore: 45 },
        { id: "sa8", title: "Concert Photography Tips for Event-Goers", slug: null, status: "gap", targetKeyword: "concert photography tips", volume: 1200, position: null, linkedToPillar: false, contentScore: null },
        { id: "sa9", title: "Lagos Concert Calendar 2026", slug: null, status: "gap", targetKeyword: "concerts Lagos 2026", volume: 4200, position: null, linkedToPillar: false, contentScore: null },
      ],
      internalLinks: [
        { id: "il4", sourceUrl: "/blog/best-venues-lagos", sourceTitle: "Best Venues Lagos", targetUrl: "/blog/live-music-lagos", targetTitle: "Live Music Events Lagos", anchorText: "live music events", status: "active", linkEquity: "high" },
      ],
    },
    {
      id: "tc3", pillarTopic: "Event Planning Guide Nigeria", pillarUrl: null, pillarStatus: "planned",
      totalVolume: 6500, coverageScore: 25,
      supportingArticles: [
        { id: "sa10", title: "Event Planning Checklist for Nigeria", slug: null, status: "planned", targetKeyword: "event planning checklist Nigeria", volume: 2400, position: null, linkedToPillar: false, contentScore: null },
        { id: "sa11", title: "How to Promote Events on Social Media", slug: null, status: "gap", targetKeyword: "event promotion social media", volume: 1800, position: null, linkedToPillar: false, contentScore: null },
        { id: "sa12", title: "Event Budget Template for Nigerian Organizers", slug: null, status: "gap", targetKeyword: "event budget template Nigeria", volume: 980, position: null, linkedToPillar: false, contentScore: null },
      ],
      internalLinks: [],
    },
  ],
  sippy: [
    {
      id: "tc4", pillarTopic: "Best Bars in Lagos", pillarUrl: "/blog/best-bars-lagos", pillarStatus: "published",
      totalVolume: 14200, coverageScore: 65,
      supportingArticles: [
        { id: "sa13", title: "Top 10 Cocktail Bars on Victoria Island", slug: "/blog/cocktail-bars-vi", status: "published", targetKeyword: "cocktail bars Victoria Island", volume: 2200, position: 9, linkedToPillar: true, contentScore: 85 },
        { id: "sa14", title: "Rooftop Bars Lagos: The Complete Guide", slug: "/blog/rooftop-bars-lagos", status: "draft", targetKeyword: "rooftop bars Lagos", volume: 3100, position: null, linkedToPillar: false, contentScore: 62 },
        { id: "sa15", title: "Best Happy Hour Deals in Lagos", slug: null, status: "gap", targetKeyword: "happy hour Lagos", volume: 2100, position: null, linkedToPillar: false, contentScore: null },
        { id: "sa16", title: "Date Night Bars Lagos", slug: null, status: "gap", targetKeyword: "date night bars Lagos", volume: 1600, position: null, linkedToPillar: false, contentScore: null },
      ],
      internalLinks: [
        { id: "il5", sourceUrl: "/blog/cocktail-bars-vi", sourceTitle: "Cocktail Bars VI", targetUrl: "/blog/best-bars-lagos", targetTitle: "Best Bars Lagos", anchorText: "best bars in Lagos", status: "active", linkEquity: "high" },
        { id: "il6", sourceUrl: "/blog/best-bars-lagos", sourceTitle: "Best Bars Lagos", targetUrl: "/blog/rooftop-bars-lagos", targetTitle: "Rooftop Bars", anchorText: "rooftop bars", status: "suggested", linkEquity: "medium" },
      ],
    },
    {
      id: "tc5", pillarTopic: "Lagos Nightlife Guide", pillarUrl: "/blog/lagos-nightlife-guide", pillarStatus: "draft",
      totalVolume: 9600, coverageScore: 35,
      supportingArticles: [
        { id: "sa17", title: "Nightlife on Lagos Island: Where to Go", slug: null, status: "planned", targetKeyword: "nightlife Lagos Island", volume: 3800, position: null, linkedToPillar: false, contentScore: null },
        { id: "sa18", title: "What to Wear to Lagos Nightclubs", slug: null, status: "gap", targetKeyword: "Lagos nightclub dress code", volume: 1200, position: null, linkedToPillar: false, contentScore: null },
      ],
      internalLinks: [],
    },
  ],
};

// ─── Blog Posts ────────────────────────────────────────────────

export const mockBlogPosts: Record<string, BlogPost[]> = {
  gruve: [
    {
      id: "bp1", title: "How to Buy Event Tickets Online in Nigeria", slug: "buy-tickets-online-nigeria",
      targetKeyword: "buy event tickets online Nigeria", secondaryKeywords: ["online ticketing Nigeria", "event tickets Lagos", "buy tickets Gruve"],
      metaDescription: "Learn how to buy event tickets online in Nigeria. Compare platforms, find the best deals, and never miss a live event again.",
      status: "published", contentScore: 82, wordCount: 2450,
      headingStructure: [
        { level: "h1", text: "How to Buy Event Tickets Online in Nigeria", keywordPresent: true },
        { level: "h2", text: "Why Online Ticketing Is Growing in Nigeria", keywordPresent: false },
        { level: "h2", text: "Step-by-Step Guide to Buying Tickets", keywordPresent: true },
        { level: "h3", text: "1. Choose Your Event Platform", keywordPresent: false },
        { level: "h3", text: "2. Select Your Event and Ticket Type", keywordPresent: false },
        { level: "h3", text: "3. Payment Options in Nigeria", keywordPresent: false },
        { level: "h2", text: "Best Event Ticketing Platforms Compared", keywordPresent: true },
        { level: "h2", text: "Tips to Get the Best Ticket Deals", keywordPresent: false },
        { level: "h2", text: "Frequently Asked Questions", keywordPresent: false },
      ],
      faqItems: [
        { question: "Is it safe to buy event tickets online in Nigeria?", answer: "Yes, reputable platforms like Gruve use secure payment gateways..." },
        { question: "Can I get a refund on my event ticket?", answer: "Refund policies vary by event organizer..." },
        { question: "What payment methods are accepted?", answer: "Most platforms accept bank transfer, card payment, and mobile money..." },
      ],
      schemaMarkup: "faq", createdAt: "Mar 28", clusterId: "tc1",
    },
    {
      id: "bp2", title: "Top 10 Event Ticketing Platforms in Nigeria (2026)", slug: "ticketing-platforms-compared",
      targetKeyword: "event ticketing platform Nigeria", secondaryKeywords: ["ticketing platforms compared", "best ticketing platform Africa"],
      metaDescription: "Compare the top 10 event ticketing platforms in Nigeria. Features, pricing, and which one is right for your event.",
      status: "published", contentScore: 71, wordCount: 3200,
      headingStructure: [
        { level: "h1", text: "Top 10 Event Ticketing Platforms in Nigeria", keywordPresent: true },
        { level: "h2", text: "What to Look for in a Ticketing Platform", keywordPresent: false },
        { level: "h2", text: "1. Gruve — Best for Live Events", keywordPresent: false },
        { level: "h2", text: "2. Tix Africa — Widest Selection", keywordPresent: false },
        { level: "h2", text: "3. Eventbrite — Global Reach", keywordPresent: false },
      ],
      faqItems: [
        { question: "Which ticketing platform has the lowest fees?", answer: "Gruve offers the most competitive pricing for Nigerian events..." },
      ],
      schemaMarkup: "article", createdAt: "Mar 22", clusterId: "tc1",
    },
    {
      id: "bp3", title: "Event Ticket Pricing: The Complete Guide for Organizers", slug: "ticket-pricing-guide",
      targetKeyword: "how to price event tickets", secondaryKeywords: ["event pricing strategy", "ticket pricing Nigeria"],
      metaDescription: "Master event ticket pricing with our complete guide. Early bird strategies, tiered pricing, and dynamic pricing explained.",
      status: "editing", contentScore: 58, wordCount: 1800,
      headingStructure: [
        { level: "h1", text: "Event Ticket Pricing: The Complete Guide", keywordPresent: true },
        { level: "h2", text: "Understanding Your Event Costs", keywordPresent: false },
        { level: "h2", text: "Pricing Strategies That Work", keywordPresent: false },
      ],
      faqItems: [],
      schemaMarkup: "howto", createdAt: "Apr 5", clusterId: "tc1",
    },
    {
      id: "bp4", title: "Best Live Music Venues in Lagos 2026", slug: "best-venues-lagos",
      targetKeyword: "best live music venues Lagos", secondaryKeywords: ["Lagos music venues", "where to see live music Lagos"],
      metaDescription: "Discover the best live music venues in Lagos for 2026. From intimate jazz clubs to massive concert halls.",
      status: "published", contentScore: 76, wordCount: 2800,
      headingStructure: [
        { level: "h1", text: "Best Live Music Venues in Lagos 2026", keywordPresent: true },
        { level: "h2", text: "Top Picks by Music Genre", keywordPresent: false },
        { level: "h2", text: "Venues by Location", keywordPresent: false },
        { level: "h2", text: "Upcoming Events at These Venues", keywordPresent: false },
      ],
      faqItems: [
        { question: "What is the best live music venue in Lagos?", answer: "It depends on your genre preference. For Afrobeats..." },
      ],
      schemaMarkup: "article", createdAt: "Mar 15", clusterId: "tc2",
    },
    {
      id: "bp5", title: "Afrobeats Live: Everything You Need to Know", slug: "afrobeats-live-guide",
      targetKeyword: "Afrobeats live show", secondaryKeywords: ["Afrobeats concerts Nigeria", "what to expect Afrobeats show"],
      metaDescription: "Your complete guide to Afrobeats live shows in Nigeria. What to expect, what to wear, and how to get tickets.",
      status: "review", contentScore: 45, wordCount: 1200,
      headingStructure: [
        { level: "h1", text: "Afrobeats Live: Everything You Need to Know", keywordPresent: true },
        { level: "h2", text: "What to Expect at an Afrobeats Show", keywordPresent: false },
      ],
      faqItems: [],
      schemaMarkup: "article", createdAt: "Apr 10", clusterId: "tc2",
    },
  ],
  sippy: [
    {
      id: "bp6", title: "The Ultimate Guide to Lagos Bars in 2026", slug: "best-bars-lagos",
      targetKeyword: "best bars in Lagos", secondaryKeywords: ["Lagos bars guide", "where to drink Lagos"],
      metaDescription: "Your definitive guide to the best bars in Lagos. Cocktail bars, rooftop lounges, dive bars, and hidden gems.",
      status: "published", contentScore: 85, wordCount: 3500,
      headingStructure: [
        { level: "h1", text: "The Ultimate Guide to Lagos Bars in 2026", keywordPresent: true },
        { level: "h2", text: "Cocktail Bars", keywordPresent: false },
        { level: "h2", text: "Rooftop Bars", keywordPresent: false },
        { level: "h2", text: "Neighborhood Guides", keywordPresent: false },
        { level: "h2", text: "Budget-Friendly Options", keywordPresent: false },
      ],
      faqItems: [
        { question: "What is the best cocktail bar in Lagos?", answer: "Sippy on Victoria Island is known for innovative cocktails..." },
        { question: "What time do bars close in Lagos?", answer: "Most Lagos bars stay open until 2-4 AM on weekends..." },
      ],
      schemaMarkup: "faq", createdAt: "Mar 20", clusterId: "tc4",
    },
    {
      id: "bp7", title: "Top 10 Cocktail Bars on Victoria Island", slug: "cocktail-bars-vi",
      targetKeyword: "cocktail bars Victoria Island", secondaryKeywords: ["VI bars Lagos", "best cocktails Victoria Island"],
      metaDescription: "Discover the 10 best cocktail bars on Victoria Island, Lagos. Signature drinks, ambiance, and booking info.",
      status: "published", contentScore: 78, wordCount: 2600,
      headingStructure: [
        { level: "h1", text: "Top 10 Cocktail Bars on Victoria Island", keywordPresent: true },
        { level: "h2", text: "1. Sippy — Best Overall", keywordPresent: false },
        { level: "h2", text: "2. Sky Lounge — Best Views", keywordPresent: false },
      ],
      faqItems: [],
      schemaMarkup: "article", createdAt: "Mar 25", clusterId: "tc4",
    },
    {
      id: "bp8", title: "Rooftop Bars Lagos: The Complete Guide", slug: "rooftop-bars-lagos",
      targetKeyword: "rooftop bars Lagos", secondaryKeywords: ["Lagos rooftop lounges", "sky bars Lagos"],
      metaDescription: "Every rooftop bar in Lagos worth visiting. Views, vibes, prices, and the best times to go.",
      status: "editing", contentScore: 62, wordCount: 1900,
      headingStructure: [
        { level: "h1", text: "Rooftop Bars Lagos: The Complete Guide", keywordPresent: true },
        { level: "h2", text: "Top Rooftop Picks", keywordPresent: false },
      ],
      faqItems: [],
      schemaMarkup: "article", createdAt: "Apr 8", clusterId: "tc4",
    },
  ],
};

// ─── Content Score Breakdowns ─────────────────────────────────

export const mockContentScores: Record<string, ContentScoreBreakdown> = {
  bp1: { overall: 82, titleOptimization: 9, keywordDensity: 8, headingStructure: 9, metaDescription: 8, readability: 8, internalLinks: 7, imageAltTags: 6, contentLength: 9, faqPresence: 10 },
  bp2: { overall: 71, titleOptimization: 8, keywordDensity: 7, headingStructure: 7, metaDescription: 7, readability: 7, internalLinks: 5, imageAltTags: 4, contentLength: 10, faqPresence: 6 },
  bp3: { overall: 58, titleOptimization: 7, keywordDensity: 6, headingStructure: 4, metaDescription: 6, readability: 7, internalLinks: 3, imageAltTags: 2, contentLength: 5, faqPresence: 0 },
  bp4: { overall: 76, titleOptimization: 9, keywordDensity: 7, headingStructure: 8, metaDescription: 8, readability: 8, internalLinks: 6, imageAltTags: 5, contentLength: 9, faqPresence: 6 },
  bp5: { overall: 45, titleOptimization: 6, keywordDensity: 5, headingStructure: 3, metaDescription: 5, readability: 6, internalLinks: 2, imageAltTags: 1, contentLength: 3, faqPresence: 0 },
  bp6: { overall: 85, titleOptimization: 9, keywordDensity: 8, headingStructure: 9, metaDescription: 9, readability: 9, internalLinks: 8, imageAltTags: 7, contentLength: 10, faqPresence: 8 },
  bp7: { overall: 78, titleOptimization: 8, keywordDensity: 8, headingStructure: 8, metaDescription: 7, readability: 8, internalLinks: 6, imageAltTags: 5, contentLength: 9, faqPresence: 3 },
  bp8: { overall: 62, titleOptimization: 7, keywordDensity: 6, headingStructure: 5, metaDescription: 7, readability: 7, internalLinks: 4, imageAltTags: 3, contentLength: 6, faqPresence: 0 },
};

// ─── Programmatic SEO ─────────────────────────────────────────

export const mockProgrammaticTemplates: Record<string, ProgrammaticTemplate[]> = {
  gruve: [
    {
      id: "pt1", name: "Event Ticketing by City", pattern: "Event Ticketing in {city}",
      variables: [{ name: "city", values: ["Lagos", "Abuja", "Port Harcourt", "Ibadan", "Enugu", "Calabar", "Kano"] }],
      totalPages: 7, indexedPages: 5, avgPosition: 18,
      generatedPages: [
        { id: "pp1", title: "Event Ticketing in Lagos", slug: "event-ticketing-lagos", variables: { city: "Lagos" }, status: "ranking", position: 8, impressions: 4200, clicks: 380 },
        { id: "pp2", title: "Event Ticketing in Abuja", slug: "event-ticketing-abuja", variables: { city: "Abuja" }, status: "indexed", position: 22, impressions: 1800, clicks: 95 },
        { id: "pp3", title: "Event Ticketing in Port Harcourt", slug: "event-ticketing-port-harcourt", variables: { city: "Port Harcourt" }, status: "indexed", position: 31, impressions: 620, clicks: 28 },
        { id: "pp4", title: "Event Ticketing in Ibadan", slug: "event-ticketing-ibadan", variables: { city: "Ibadan" }, status: "indexed", position: 19, impressions: 840, clicks: 52 },
        { id: "pp5", title: "Event Ticketing in Enugu", slug: "event-ticketing-enugu", variables: { city: "Enugu" }, status: "indexed", position: 15, impressions: 450, clicks: 38 },
        { id: "pp6", title: "Event Ticketing in Calabar", slug: "event-ticketing-calabar", variables: { city: "Calabar" }, status: "not_indexed", position: null, impressions: 0, clicks: 0 },
        { id: "pp7", title: "Event Ticketing in Kano", slug: "event-ticketing-kano", variables: { city: "Kano" }, status: "not_indexed", position: null, impressions: 0, clicks: 0 },
      ],
    },
    {
      id: "pt2", name: "Events by Type", pattern: "{eventType} Events in Lagos",
      variables: [{ name: "eventType", values: ["Music", "Comedy", "Art", "Food", "Tech", "Fashion"] }],
      totalPages: 6, indexedPages: 4, avgPosition: 24,
      generatedPages: [
        { id: "pp8", title: "Music Events in Lagos", slug: "music-events-lagos", variables: { eventType: "Music" }, status: "ranking", position: 12, impressions: 3800, clicks: 290 },
        { id: "pp9", title: "Comedy Events in Lagos", slug: "comedy-events-lagos", variables: { eventType: "Comedy" }, status: "indexed", position: 28, impressions: 1200, clicks: 65 },
        { id: "pp10", title: "Art Events in Lagos", slug: "art-events-lagos", variables: { eventType: "Art" }, status: "indexed", position: 20, impressions: 680, clicks: 42 },
        { id: "pp11", title: "Food Events in Lagos", slug: "food-events-lagos", variables: { eventType: "Food" }, status: "indexed", position: 35, impressions: 520, clicks: 18 },
        { id: "pp12", title: "Tech Events in Lagos", slug: "tech-events-lagos", variables: { eventType: "Tech" }, status: "not_indexed", position: null, impressions: 0, clicks: 0 },
        { id: "pp13", title: "Fashion Events in Lagos", slug: "fashion-events-lagos", variables: { eventType: "Fashion" }, status: "not_indexed", position: null, impressions: 0, clicks: 0 },
      ],
    },
  ],
  sippy: [
    {
      id: "pt3", name: "Bars by Neighborhood", pattern: "Best Bars in {neighborhood}",
      variables: [{ name: "neighborhood", values: ["Victoria Island", "Lekki", "Ikeja", "Ikoyi", "Surulere"] }],
      totalPages: 5, indexedPages: 3, avgPosition: 15,
      generatedPages: [
        { id: "pp14", title: "Best Bars in Victoria Island", slug: "best-bars-victoria-island", variables: { neighborhood: "Victoria Island" }, status: "ranking", position: 6, impressions: 5200, clicks: 620 },
        { id: "pp15", title: "Best Bars in Lekki", slug: "best-bars-lekki", variables: { neighborhood: "Lekki" }, status: "ranking", position: 11, impressions: 3100, clicks: 280 },
        { id: "pp16", title: "Best Bars in Ikeja", slug: "best-bars-ikeja", variables: { neighborhood: "Ikeja" }, status: "indexed", position: 28, impressions: 890, clicks: 45 },
        { id: "pp17", title: "Best Bars in Ikoyi", slug: "best-bars-ikoyi", variables: { neighborhood: "Ikoyi" }, status: "not_indexed", position: null, impressions: 0, clicks: 0 },
        { id: "pp18", title: "Best Bars in Surulere", slug: "best-bars-surulere", variables: { neighborhood: "Surulere" }, status: "not_indexed", position: null, impressions: 0, clicks: 0 },
      ],
    },
  ],
};

// ─── SERP Analysis ────────────────────────────────────────────

export const mockSERPAnalyses: Record<string, SERPAnalysis[]> = {
  gruve: [
    {
      id: "serp1", keyword: "event ticketing Nigeria", volume: 2400, analyzedAt: "Apr 12",
      difficulty: "medium", ourPosition: 11, ourUrl: "/events",
      avgWordCount: 2800, avgDomainAuthority: 35, recommendedWordCount: 3000,
      recommendedHeadings: ["What is Event Ticketing", "Best Platforms in Nigeria", "How to Buy Tickets", "Pricing Guide", "Payment Methods", "FAQ"],
      contentGaps: ["Mobile app comparison", "Offline ticket purchase options", "Group booking discounts", "Student ticket pricing"],
      results: [
        { position: 1, url: "https://tix.africa/guide", title: "Event Ticketing in Nigeria — Complete Guide", domain: "tix.africa", domainAuthority: 42, wordCount: 3800, headings: ["Guide", "Platforms", "How to Buy", "FAQ"], hasSchema: true, hasFAQ: true, hasVideo: false, backlinks: 128, contentAge: "3 months" },
        { position: 2, url: "https://eventbrite.com/l/nigeria", title: "Events in Nigeria — Eventbrite", domain: "eventbrite.com", domainAuthority: 89, wordCount: 1200, headings: ["Browse Events", "Categories"], hasSchema: true, hasFAQ: false, hasVideo: false, backlinks: 450, contentAge: "1 year" },
        { position: 3, url: "https://nairabox.com/blog/ticketing", title: "How to Buy Event Tickets Online", domain: "nairabox.com", domainAuthority: 38, wordCount: 2400, headings: ["Step-by-Step", "Payment Options", "Tips"], hasSchema: false, hasFAQ: true, hasVideo: true, backlinks: 65, contentAge: "6 months" },
        { position: 4, url: "https://guardian.ng/entertainment", title: "Online Ticketing Boom in Nigeria", domain: "guardian.ng", domainAuthority: 72, wordCount: 1800, headings: ["Market Growth", "Key Players"], hasSchema: false, hasFAQ: false, hasVideo: false, backlinks: 210, contentAge: "8 months" },
        { position: 5, url: "https://techcabal.com/ticketing", title: "The State of Event Tech in Nigeria", domain: "techcabal.com", domainAuthority: 65, wordCount: 2200, headings: ["Market Overview", "Platforms", "Future"], hasSchema: true, hasFAQ: false, hasVideo: false, backlinks: 180, contentAge: "4 months" },
      ],
    },
    {
      id: "serp2", keyword: "live music events Lagos", volume: 3200, analyzedAt: "Apr 10",
      difficulty: "hard", ourPosition: 18, ourUrl: "/events/music",
      avgWordCount: 2200, avgDomainAuthority: 48, recommendedWordCount: 2500,
      recommendedHeadings: ["Upcoming Events", "Venues", "How to Get Tickets", "Genre Guide", "Monthly Calendar"],
      contentGaps: ["Monthly event calendar", "Venue capacity info", "Artist lineup previews", "VIP experience guides"],
      results: [
        { position: 1, url: "https://bellanaija.com/events/music", title: "Live Music Events in Lagos This Month", domain: "bellanaija.com", domainAuthority: 78, wordCount: 2800, headings: ["This Month", "Venues", "Tickets"], hasSchema: true, hasFAQ: false, hasVideo: true, backlinks: 340, contentAge: "2 weeks" },
        { position: 2, url: "https://pulse.ng/entertainment", title: "Lagos Music Events Calendar", domain: "pulse.ng", domainAuthority: 72, wordCount: 1800, headings: ["Calendar", "Artists", "Venues"], hasSchema: false, hasFAQ: false, hasVideo: false, backlinks: 220, contentAge: "1 month" },
        { position: 3, url: "https://tix.africa/lagos-music", title: "Music Events Lagos — Buy Tickets", domain: "tix.africa", domainAuthority: 42, wordCount: 2400, headings: ["Browse Events", "Popular", "Upcoming"], hasSchema: true, hasFAQ: true, hasVideo: false, backlinks: 95, contentAge: "2 months" },
      ],
    },
  ],
  sippy: [
    {
      id: "serp3", keyword: "best bars Lagos", volume: 5400, analyzedAt: "Apr 11",
      difficulty: "hard", ourPosition: 15, ourUrl: "/",
      avgWordCount: 3200, avgDomainAuthority: 52, recommendedWordCount: 3500,
      recommendedHeadings: ["Top Picks", "By Neighborhood", "By Vibe", "Budget Guide", "Booking Tips", "FAQ"],
      contentGaps: ["Price range comparison", "Reservation info", "Live music schedules at bars", "Parking and transport tips"],
      results: [
        { position: 1, url: "https://guardian.ng/life/bars-lagos", title: "30 Best Bars in Lagos", domain: "guardian.ng", domainAuthority: 72, wordCount: 4200, headings: ["Top 30", "By Area", "New Openings"], hasSchema: false, hasFAQ: false, hasVideo: false, backlinks: 380, contentAge: "5 months" },
        { position: 2, url: "https://bellanaija.com/lifestyle/bars", title: "Lagos Bar Guide 2026", domain: "bellanaija.com", domainAuthority: 78, wordCount: 3500, headings: ["Guide", "Cocktail", "Rooftop", "Budget"], hasSchema: true, hasFAQ: true, hasVideo: true, backlinks: 290, contentAge: "3 months" },
        { position: 3, url: "https://tripadvisor.com/lagos-bars", title: "Top Bars in Lagos — Tripadvisor", domain: "tripadvisor.com", domainAuthority: 93, wordCount: 800, headings: ["Rankings", "Reviews"], hasSchema: true, hasFAQ: false, hasVideo: false, backlinks: 1200, contentAge: "1 year" },
      ],
    },
  ],
};
