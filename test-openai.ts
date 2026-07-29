import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

async function main() {
  console.log("Starting...");
  try {
    const result = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: "Say hello",
      timeout: 10_000,
    });
    console.log("Success:", result.text);
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
