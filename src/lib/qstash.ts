// QStash client wrapper — schedules HTTP callbacks via Upstash QStash.
// QStash has a 7-day max delay; the schedule-flush cron re-enqueues posts beyond that.

import { Client } from "@upstash/qstash";

let _client: Client | null = null;

function getClient(): Client {
  if (!_client) {
    const token = process.env.QSTASH_TOKEN;
    if (!token) throw new Error("QSTASH_TOKEN is not set");
    _client = new Client({ token });
  }
  return _client;
}

export function isQStashConfigured(): boolean {
  return !!process.env.QSTASH_TOKEN;
}

interface EnqueueAtOptions {
  url: string;
  body: unknown;
  notBefore: Date;
  retries?: number;
}

/** Enqueue a message to be delivered at a specific time. Returns the QStash messageId. */
export async function enqueueAt(opts: EnqueueAtOptions): Promise<string> {
  const client = getClient();
  const delaySeconds = Math.max(0, Math.floor((opts.notBefore.getTime() - Date.now()) / 1000));

  const res = await client.publishJSON({
    url: opts.url,
    body: opts.body,
    delay: delaySeconds,
    retries: opts.retries ?? 3,
  });
  return res.messageId;
}

/** Enqueue a message for immediate delivery. Returns the QStash messageId. */
export async function enqueueNow(url: string, body: unknown, retries = 3): Promise<string> {
  const client = getClient();
  const res = await client.publishJSON({ url, body, retries });
  return res.messageId;
}

/** Verify an incoming QStash webhook signature. Returns true if valid. */
export async function verifyQStashSignature(
  body: string,
  signature: string
): Promise<boolean> {
  const { Receiver } = await import("@upstash/qstash");
  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY ?? "",
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY ?? "",
  });
  try {
    await receiver.verify({ signature, body });
    return true;
  } catch {
    return false;
  }
}

// Max delay QStash supports — posts beyond this need schedule-flush re-enqueue
export const QSTASH_MAX_DELAY_DAYS = 7;
