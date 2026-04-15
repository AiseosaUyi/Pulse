"use server";

export async function submitCompetitorPost(formData: FormData) {
  const summary = formData.get("summary") as string;
  const views = formData.get("views") as string;
  const likes = formData.get("likes") as string;
  const comments = formData.get("comments") as string;
  const shares = formData.get("shares") as string;

  if (!summary?.trim()) {
    return { success: false, error: "Summary is required" };
  }

  const hasMetric = [views, likes, comments, shares].some(
    (v) => v && Number(v) > 0
  );
  if (!hasMetric) {
    return { success: false, error: "At least one engagement metric is required" };
  }

  // Phase 1: mock success. Phase 1.5: store in Supabase + call OpenAI
  return {
    success: true,
    cardId: `intel-${Date.now()}`,
    message: "Competitor post added. AI analysis will appear shortly.",
  };
}

export async function generateContentBrief(
  intelCardId: string,
  tenantSlug: string
) {
  // Phase 1: mock brief. Phase 1.5: call OpenAI gpt-4o with brand voice
  return {
    success: true,
    brief: {
      id: `brief-${Date.now()}`,
      tenantId: tenantSlug,
      triggeredBy: intelCardId,
      platform: "instagram",
      contentType: "reel",
      title: "BTS Reel: Your Version",
      outline: [
        "15-second BTS clip from next event/venue",
        "Lo-fi edit with trending afrobeats audio",
        "No hard sell — pure vibes and atmosphere",
        "Caption: location tease + FOMO trigger",
      ],
      draftContent:
        "When the sunset hits different at your venue... 🌅 Shot on iPhone, lo-fi edit. No filter needed when the vibes are this real. 📍 Drop a 🔥 if you'd pull up.",
      status: "draft" as const,
      generatedAt: new Date().toISOString(),
    },
  };
}
