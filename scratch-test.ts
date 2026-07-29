import { selectTopic } from "./src/lib/ai/content-calendar";

async function run() {
  try {
    const res = await selectTopic({
      tenantSlug: "aiseosa-space",
      niches: ["AI", "Startups", "Coding"],
      interestTags: ["Next.js", "AI SDK"],
      trends: [],
      excludeTitles: [],
      usedPillars: [],
      usedFormats: [],
      currentYear: 2026,
      todayIso: "2026-07-29",
    });
    console.log("Success:", res);
  } catch (err) {
    console.error("Error:", err);
  }
}
run();
