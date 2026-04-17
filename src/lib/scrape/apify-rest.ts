// Minimal Apify REST client. Replaces apify-client SDK to avoid its
// peer-dependency drama on Vercel (proxy-agent not hoisted by pnpm).

const BASE = "https://api.apify.com/v2";

interface RunActorOptions {
  token: string;
  actorId: string;       // format "username~actor-name"
  input: unknown;
  timeout?: number;      // seconds
  memory?: number;       // MB
}

export async function runActorSync<T>(
  opts: RunActorOptions
): Promise<T[]> {
  const url = new URL(`${BASE}/acts/${opts.actorId}/run-sync-get-dataset-items`);
  url.searchParams.set("token", opts.token);
  if (opts.timeout) url.searchParams.set("timeout", String(opts.timeout));
  if (opts.memory) url.searchParams.set("memory", String(opts.memory));

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts.input),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Apify ${opts.actorId} returned ${res.status}: ${body.slice(0, 300)}`
    );
  }

  const data = (await res.json()) as T[] | unknown;
  if (!Array.isArray(data)) {
    throw new Error(
      `Apify ${opts.actorId} returned non-array: ${JSON.stringify(data).slice(0, 300)}`
    );
  }
  return data as T[];
}
