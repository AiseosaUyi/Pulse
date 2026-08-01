// Runs every 30 minutes — matches the industry-standard cadence for this
// kind of rule (checked periodically, never on every single insight write,
// so a rule can't thrash on noisy intraday data).

import { listEnabledAdBudgetRules } from "@/lib/services/ad-budget-rules";
import { evaluateAdBudgetRule } from "@/lib/services/ad-budget-rule-engine";

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rules = await listEnabledAdBudgetRules();
  let evaluated = 0;
  let errors = 0;

  for (const rule of rules) {
    try {
      await evaluateAdBudgetRule(rule);
      evaluated++;
    } catch (err) {
      console.error("[evaluate-ad-budget-rules] failed for rule", rule.id, err instanceof Error ? err.message : err);
      errors++;
    }
  }

  return Response.json({ evaluated, errors, total: rules.length });
}
