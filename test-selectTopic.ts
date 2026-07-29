import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const CONTENT_FORMATS = ["teardown", "how_to", "hot_take", "personal_story", "listicle", "news_reaction"] as const;

const topicSelectSchema = z.object({
  topicTitle: z.string(),
  searchQuery: z.string(),
  pillar: z.string(),
  format: z.enum(CONTENT_FORMATS),
});

async function main() {
  console.log("Starting...");
  try {
    const result = await generateText({
      model: openai("gpt-4o-mini"),
      output: Output.object({ schema: topicSelectSchema }),
      system: "You are a content calendar AI.",
      prompt: "Pick a topic.",
      timeout: 45_000,
    });
    console.log("Success:", result.output);
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
