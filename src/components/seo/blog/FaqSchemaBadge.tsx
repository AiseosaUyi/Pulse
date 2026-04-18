// Badge indicating whether a post has FAQ schema markup (and whether
// it's valid JSON-LD). Rendered on the blog card. Color + copy match
// the FAQ sub-score signal so users can reason about both consistently.

import { CheckCircle2, AlertCircle, Circle } from "lucide-react";

interface Props {
  /** JSON-LD FAQPage object from blog_posts.faq_schema, or null. */
  faqSchema: unknown | null;
}

interface ParsedFaqState {
  present: boolean;
  valid: boolean;
  count: number;
}

function inspect(schema: unknown): ParsedFaqState {
  if (!schema || typeof schema !== "object") {
    return { present: false, valid: false, count: 0 };
  }
  const obj = schema as {
    "@type"?: unknown;
    mainEntity?: unknown;
  };
  const typeOk = obj["@type"] === "FAQPage";
  const entities = Array.isArray(obj.mainEntity) ? obj.mainEntity : [];
  return {
    present: true,
    valid: typeOk && entities.length >= 1,
    count: entities.length,
  };
}

export function FaqSchemaBadge({ faqSchema }: Props) {
  const state = inspect(faqSchema);

  if (!state.present) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-sidebar border border-border text-text-muted"
        title="No FAQ schema markup. Adds a rich result in Google when valid."
      >
        <Circle size={10} />
        No FAQ schema
      </span>
    );
  }
  if (!state.valid) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-status-yellow/10 border border-status-yellow/30 text-status-yellow"
        title="FAQ schema exists but is malformed. Regenerate to fix."
      >
        <AlertCircle size={10} />
        FAQ schema invalid
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-status-green/10 border border-status-green/30 text-status-green"
      title={`Valid FAQ schema with ${state.count} question${state.count === 1 ? "" : "s"}.`}
    >
      <CheckCircle2 size={10} />
      FAQ · {state.count} Q
    </span>
  );
}
