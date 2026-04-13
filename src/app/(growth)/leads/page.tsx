import { cookies } from "next/headers";
import { mockLeads } from "@/lib/data/mock-modules";
import { Badge } from "@/components/ui/Badge";

export default async function LeadsPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const leads = mockLeads[tenantSlug] ?? mockLeads.gruve;

  const statusBadge: Record<string, { variant: "active" | "urgent" | "overdue" | "opportunity" | "high_impact"; label: string }> = {
    new: { variant: "opportunity", label: "New" },
    contacted: { variant: "active", label: "Contacted" },
    warm: { variant: "high_impact", label: "Warm" },
    cold: { variant: "overdue", label: "Cold" },
    converted: { variant: "active", label: "Converted" },
  };

  const typeLabels: Record<string, string> = {
    venue: "Venue", sponsor: "Sponsor", partner: "Partner", influencer: "Influencer", media: "Media",
  };

  const warmCount = leads.filter((l) => l.status === "warm").length;
  const coldCount = leads.filter((l) => l.status === "cold").length;
  const newCount = leads.filter((l) => l.status === "new").length;

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Leads & Outreach</h1>
          <p className="text-text-secondary text-sm mt-0.5">Track and manage your marketing leads</p>
        </div>
        <button className="px-4 py-2 gradient-purple-pink text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity active:scale-[0.98]">
          Add Lead
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Total Leads</p>
          <p className="text-2xl font-bold text-white mt-1">{leads.length}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Warm</p>
          <p className="text-2xl font-bold text-status-purple mt-1">{warmCount}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Gone Cold</p>
          <p className="text-2xl font-bold text-status-red mt-1">{coldCount}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">New This Week</p>
          <p className="text-2xl font-bold text-status-green mt-1">{newCount}</p>
        </div>
      </div>

      {/* Lead table */}
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
                <td className="px-5 py-3.5 text-sm text-white font-medium">{lead.name}</td>
                <td className="px-5 py-3.5 text-sm text-text-secondary">{lead.company}</td>
                <td className="px-5 py-3.5 text-xs text-text-muted">{typeLabels[lead.type]}</td>
                <td className="px-5 py-3.5">
                  <Badge variant={statusBadge[lead.status].variant}>
                    {statusBadge[lead.status].label}
                  </Badge>
                </td>
                <td className="px-5 py-3.5 text-sm text-text-secondary">{lead.lastContact}</td>
                <td className="px-5 py-3.5 text-sm text-text-secondary max-w-[200px] truncate">{lead.nextAction}</td>
                <td className="px-5 py-3.5">
                  <span className={`text-xs font-medium ${lead.value === "Very High" ? "text-accent-purple" : lead.value === "High" ? "text-status-green" : "text-text-secondary"}`}>
                    {lead.value}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
