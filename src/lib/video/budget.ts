// Video generation budget gate. Extends the AI USD budget with a live provider
// credit-balance check. Called by startGeneration AFTER every clip is quoted,
// BEFORE any clip is submitted — no spend until both gates pass.

import { getBudgetStatus, BudgetExceededError } from "@/lib/ai/ai-budget";
import { picsartCreditUsd } from "@/lib/video/providers/picsart";
import type { VideoProvider } from "@/lib/video/providers/types";

export class InsufficientCreditsError extends Error {
  constructor(public needed: number, public balance: number) {
    super(
      `Insufficient provider credits: need ${needed}, have ${balance}. Top up to continue.`
    );
    this.name = "InsufficientCreditsError";
  }
}

export interface VideoBudgetCheck {
  estimateCredits: number;
  estimateUsd: number;
  creditBalance: number | null;
}

// Throws BudgetExceededError (USD ceiling) or InsufficientCreditsError
// (provider credits). Returns the check detail when both gates pass.
export async function checkVideoBudget(
  tenantSlug: string,
  estimateCredits: number,
  provider: VideoProvider
): Promise<VideoBudgetCheck> {
  const creditUsd = picsartCreditUsd();
  const estimateUsd = estimateCredits * creditUsd;

  // USD ceiling: would this generation push the month over budget?
  const status = await getBudgetStatus(tenantSlug);
  if (status.budgetUsd !== null && status.spentUsd + estimateUsd > status.budgetUsd) {
    throw new BudgetExceededError(tenantSlug, { ...status, exceeded: true });
  }

  // Live provider credit balance.
  let creditBalance: number | null = null;
  try {
    const bal = await provider.creditBalance();
    creditBalance = bal.balance;
    if (bal.balance < estimateCredits) {
      throw new InsufficientCreditsError(estimateCredits, bal.balance);
    }
  } catch (err) {
    if (err instanceof InsufficientCreditsError) throw err;
    // If the balance endpoint is unavailable, don't hard-block on it — the USD
    // ceiling already gates spend and per-clip quote() ran. Log-and-proceed.
    creditBalance = null;
  }

  return { estimateCredits, estimateUsd, creditBalance };
}
