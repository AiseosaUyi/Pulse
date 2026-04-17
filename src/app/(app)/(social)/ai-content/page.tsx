import { cookies } from "next/headers";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { mockContentSuggestions, mockCalendar } from "@/lib/data/mock-modules";
import { Badge } from "@/components/ui/Badge";

export default async function AIContentPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const suggestions = mockContentSuggestions[tenantSlug] ?? mockContentSuggestions.gruve;
  const calendar = mockCalendar[tenantSlug] ?? mockCalendar.gruve;

  const statusColors: Record<string, string> = {
    scheduled: "bg-status-green",
    draft: "bg-status-yellow",
    posted: "bg-primary-500",
  };

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="flex items-start justify-between mb-8 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Content Engine</h1>
          <p className="text-text-secondary text-sm mt-0.5">AI-generated post suggestions and content calendar</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/settings/brand-voice"
            className="inline-flex items-center gap-1.5 px-3 md:px-4 py-2 border border-border rounded-lg text-xs md:text-sm text-foreground hover:bg-card-hover transition-colors duration-150"
          >
            <Sparkles size={14} />
            Brand voice
          </Link>
          <button className="px-4 py-2 bg-primary-500 text-foreground text-sm font-medium rounded-lg hover:opacity-90 transition-opacity active:scale-[0.98]">
            Generate Ideas
          </button>
        </div>
      </div>

      {/* Content Calendar */}
      <div className="bg-card rounded-xl p-6 border border-border/50 mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground mb-4">This Week</h2>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 sm:gap-2">
          {calendar.map((day) => (
            <div key={day.date} className="text-center">
              <p className="text-text-muted text-xs mb-1">{day.dayLabel}</p>
              <div className={`rounded-lg p-3 min-h-[80px] ${day.posts.length > 0 ? "bg-background border border-border/50" : "bg-background/50"}`}>
                <p className="text-text-secondary text-xs mb-2">{day.date.split(" ")[1]}</p>
                {day.posts.length === 0 ? (
                  <p className="text-text-muted text-[10px]">No posts</p>
                ) : (
                  <div className="space-y-1">
                    {day.posts.map((post, i) => (
                      <div key={i} className="flex items-center gap-1.5 justify-center">
                        <span className={`w-1.5 h-1.5 rounded-full ${statusColors[post.status]}`} />
                        <span className="text-text-secondary text-[10px]">{post.platform}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border/30">
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-status-green" /><span className="text-text-muted text-xs">Scheduled</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-status-yellow" /><span className="text-text-muted text-xs">Draft</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary-500" /><span className="text-text-muted text-xs">Posted</span></div>
        </div>
      </div>

      {/* AI Suggestions */}
      <div className="bg-card rounded-xl p-6 border border-border/50">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground mb-5">AI-Generated Suggestions</h2>
        <div className="space-y-4">
          {suggestions.map((s) => (
            <div key={s.id} className="p-4 rounded-lg bg-background border border-border/30 hover:border-border transition-colors">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-primary-500">{s.platform}</span>
                  <span className="text-text-muted text-xs">·</span>
                  <span className="text-text-muted text-xs capitalize">{s.type}</span>
                </div>
                <Badge variant={s.status === "scheduled" ? "active" : "opportunity"}>
                  {s.status}
                </Badge>
              </div>
              <p className="text-foreground text-sm leading-relaxed mb-3">{s.caption}</p>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/20">
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-text-muted">Best time: <span className="text-text-secondary">{s.bestTime}</span></span>
                  <span className="text-text-muted">Est. reach: <span className="text-status-green">{s.estimatedReach}</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <button className="px-3 py-1.5 text-xs bg-primary-500/10 text-primary-500 rounded-md hover:bg-primary-500/20 transition-colors font-medium">
                    Edit Draft
                  </button>
                  <button className="px-3 py-1.5 text-xs bg-status-green/10 text-status-green rounded-md hover:bg-status-green/20 transition-colors font-medium">
                    Schedule
                  </button>
                  <button className="px-3 py-1.5 text-xs bg-background text-text-muted rounded-md hover:text-foreground transition-colors border border-border/30">
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
