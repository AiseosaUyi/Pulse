
import WebSocket from "ws";
(globalThis as any).WebSocket = WebSocket;
import { generateNextBatchApi } from "./src/lib/services/content-calendar";
import { createAdminClient } from "./src/lib/supabase/admin";

async function main() {
  const admin = createAdminClient();
  const started = Date.now();
  console.log("Starting batch generation...");

  try {
    const result = await generateNextBatchApi(admin, "aiseosa-space", null, 10);
    console.log("Success:", result);
  } catch (err) {
    console.error("Failed:", err);
  }

  const duration = Date.now() - started;
  console.log(`Finished in ${duration / 1000} seconds`);
}

main();
