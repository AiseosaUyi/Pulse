import Link from "next/link";
import { ArrowUpRight, CheckCircle2, CircleAlert } from "lucide-react";
import { getCurrentTenant } from "@/lib/auth";
import { getSetupStatus, type SetupItem } from "@/lib/services/setup-status";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<SetupItem["kind"], string> = {
  key: "Connect",
  "sign-in": "Sign in",
  info: "Fill in",
  decision: "Decide",
  access: "Needs a developer",
};

const PRIORITY_LABEL: Record<SetupItem["priority"], string> = {
  P0: "Blocking",
  P1: "Important",
  P2: "Optional",
};

const PRIORITY_TONE: Record<SetupItem["priority"], string> = {
  P0: "border-status-red/30 bg-status-red/5",
  P1: "border-status-yellow/30 bg-status-yellow/5",
  P2: "border-border bg-card",
};

export default async function NeedsYouPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return (
      <div className="p-4 md:p-8">
        <p className="text-text-secondary">Tenant not found.</p>
      </div>
    );
  }

  const status = await getSetupStatus(tenant.slug, tenant.accountType);
  const groups: SetupItem["priority"][] = ["P0", "P1", "P2"];

  return (
    <div className="p-4 md:p-8 max-w-[900px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-foreground">Needs you</h1>
        <p className="text-text-secondary text-sm mt-0.5">
          Computed live from {tenant.name}&rsquo;s own setup — this list is
          never hand-authored. An item disappears the moment it&rsquo;s
          resolved.
        </p>
      </div>

      <div className="mb-6 rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3">
        <div className="flex-1">
          <div className="h-2 rounded-full bg-sidebar overflow-hidden">
            <div
              className="h-full bg-status-green transition-all"
              style={{
                width: `${status.total === 0 ? 100 : Math.round((status.doneCount / status.total) * 100)}%`,
              }}
            />
          </div>
        </div>
        <span className="text-sm font-medium text-foreground whitespace-nowrap">
          {status.doneCount}/{status.total} set up
        </span>
      </div>

      {status.allDone ? (
        <div className="rounded-2xl border border-status-green/30 bg-status-green/5 px-4 py-6 flex flex-col items-center text-center gap-2">
          <CheckCircle2 size={28} className="text-status-green" />
          <p className="text-sm font-semibold text-foreground">
            Everything Pulse needs from you is set up
          </p>
          <p className="text-xs text-text-muted max-w-sm">
            New items will show up here automatically the moment a gap
            appears — nothing to do right now.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((priority) => {
            const items = status.items.filter((i) => i.priority === priority);
            if (items.length === 0) return null;
            return (
              <div key={priority}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
                  {PRIORITY_LABEL[priority]}
                </h2>
                <div className="space-y-2">
                  {items.map((item) => (
                    <div
                      key={item.key}
                      className={cn(
                        "flex items-start justify-between gap-3 rounded-xl border px-4 py-3",
                        item.done
                          ? "border-border bg-card opacity-60"
                          : PRIORITY_TONE[item.priority]
                      )}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        {item.done ? (
                          <CheckCircle2 size={16} className="text-status-green shrink-0 mt-0.5" />
                        ) : (
                          <CircleAlert
                            size={16}
                            className={cn(
                              "shrink-0 mt-0.5",
                              item.priority === "P0" ? "text-status-red" : "text-status-yellow"
                            )}
                          />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-foreground">
                              {item.label}
                            </span>
                            {!item.done && (
                              <span className="text-[10px] uppercase tracking-wide text-text-muted px-1.5 py-0.5 rounded-full bg-sidebar border border-border/50">
                                {KIND_LABEL[item.kind]}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-text-muted mt-0.5">{item.unblocks}</p>
                          {!item.done && (
                            <p className="text-xs text-text-muted mt-0.5">{item.hint}</p>
                          )}
                        </div>
                      </div>
                      {!item.done && item.href && (
                        <Link
                          href={item.href}
                          className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary-500 hover:text-primary-600 px-2.5 py-1.5 rounded-md hover:bg-primary-500/10 whitespace-nowrap"
                        >
                          Fix <ArrowUpRight size={12} />
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
