import { Badge } from "@/components/ui/Badge";
import { getCurrentTenant } from "@/lib/auth";
import { getLeads, summarize } from "@/lib/services/leads";
import {
  LEAD_STATUS_LABELS,
  LEAD_TYPE_LABELS,
  LEAD_VALUE_LABELS,
  type LeadStatus,
  type LeadValue,
} from "@/lib/types/leads";
import { AddLeadButton } from "./client";

const statusBadge: Record<LeadStatus, { variant: "active" | "urgent" | "overdue" | "opportunity" | "high_impact" }> = {
  new: { variant: "opportunity" },
  contacted: { variant: "active" },
  warm: { variant: "high_impact" },
  cold: { variant: "overdue" },
  converted: { variant: "active" },
};

const valueAccent: Record<LeadValue, string> = {
  low: "text-text-secondary",
  medium: "text-text-secondary",
  high: "text-status-green",
  very_high: "text-primary-500",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "—";
  const [, y, m, d] = match;
  return dateFormatter.format(new Date(Number(y), Number(m) - 1, Number(d)));
}

export default async function LeadsPage() {
  const tenant = await getCurrentTenant();
  const leads = tenant ? await getLeads(tenant.slug) : [];
  const summary = summarize(leads);

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Leads &amp; Outreach</h1>
          <p className="text-text-secondary text-sm mt-0.5">Track and manage your marketing leads</p>
        </div>
        <AddLeadButton />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Total Leads</p>
          <p className="text-2xl font-bold text-foreground mt-1">{summary.total}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Warm</p>
          <p className="text-2xl font-bold text-primary-500 mt-1">{summary.warm}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Gone Cold</p>
          <p className="text-2xl font-bold text-status-red mt-1">{summary.cold}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">New</p>
          <p className="text-2xl font-bold text-status-green mt-1">{summary.newCount}</p>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="bg-card rounded-xl border border-border/50 p-10 text-center">
          <p className="text-sm text-foreground font-medium">No leads yet</p>
          <p className="text-text-secondary text-xs mt-1">Click &ldquo;Add Lead&rdquo; to capture your first contact.</p>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 md:mx-0">
          <div className="bg-card rounded-xl border border-border/50 overflow-hidden min-w-[800px] md:min-w-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Name</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Company</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Type</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Last Contact</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Next Action</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Value</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-border/30 last:border-0 hover:bg-card-hover transition-colors">
                    <td className="px-5 py-3.5 text-sm text-foreground font-medium">{lead.name}</td>
                    <td className="px-5 py-3.5 text-sm text-text-secondary">{lead.company ?? "—"}</td>
                    <td className="px-5 py-3.5 text-xs text-text-muted">{LEAD_TYPE_LABELS[lead.type]}</td>
                    <td className="px-5 py-3.5">
                      <Badge variant={statusBadge[lead.status].variant}>
                        {LEAD_STATUS_LABELS[lead.status]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-text-secondary">{formatDate(lead.lastContact)}</td>
                    <td className="px-5 py-3.5 text-sm text-text-secondary max-w-[200px] truncate">{lead.nextAction ?? "—"}</td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-medium ${valueAccent[lead.value]}`}>
                        {LEAD_VALUE_LABELS[lead.value]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
