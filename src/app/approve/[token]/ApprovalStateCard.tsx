import { Clock, ShieldAlert, CircleCheck, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { ApprovalTarget } from "@/lib/services/approvals";

type StateKind = "expired" | "invalid" | "already_approved" | "already_rejected";

const STATE_COPY: Record<StateKind, { icon: typeof Clock; iconColor: string; title: string; body: (decidedAt?: string | null) => string }> = {
  expired: {
    icon: Clock,
    iconColor: "text-gray-500",
    title: "This link expired",
    body: () => "Ask whoever sent it for a new one.",
  },
  invalid: {
    icon: ShieldAlert,
    iconColor: "text-gray-500",
    title: "This link isn't valid",
    body: () => "Double-check you copied the whole link.",
  },
  already_approved: {
    icon: CircleCheck,
    iconColor: "text-gray-500",
    title: "Already approved",
    body: (decidedAt) => (decidedAt ? `Approved ${new Date(decidedAt).toLocaleString("en-US")}.` : "This was already approved."),
  },
  already_rejected: {
    icon: X,
    iconColor: "text-gray-500",
    title: "Already rejected",
    body: (decidedAt) => (decidedAt ? `Rejected ${new Date(decidedAt).toLocaleString("en-US")}.` : "This was already rejected."),
  },
};

function targetPreviewText(target: ApprovalTarget): string {
  return target.type === "scheduled_post" ? target.content : target.draftContent || target.title;
}

export function ApprovalStateCard({
  kind,
  decidedAt,
  target,
}: {
  kind: StateKind;
  decidedAt?: string | null;
  target?: ApprovalTarget;
}) {
  const copy = STATE_COPY[kind];
  const Icon = copy.icon;

  return (
    <div className="flex flex-col items-center text-center gap-4 pt-10">
      <Icon size={48} strokeWidth={1.75} className={copy.iconColor} />
      <div>
        <h1 className="text-lg text-gray-1100 [font-family:'Satoshi-700',var(--font-sans)]">
          {copy.title}
        </h1>
        <p className="text-sm text-gray-1000 mt-1">{copy.body(decidedAt)}</p>
      </div>

      {target && (
        <Card className="w-full mt-4 text-left">
          <CardContent className="p-4">
            <p className="text-xs text-gray-1000 mb-2">
              {target.type === "scheduled_post"
                ? `${target.platform[0].toUpperCase()}${target.platform.slice(1)} post`
                : "Content brief"}
            </p>
            <p className="text-sm text-gray-1200 whitespace-pre-wrap">{targetPreviewText(target)}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
