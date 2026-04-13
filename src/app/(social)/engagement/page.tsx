import { cookies } from "next/headers";
import { mockEngagement } from "@/lib/data/mock-engagement";
import { Badge } from "@/components/ui/Badge";

export default async function EngagementPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const items = mockEngagement[tenantSlug] ?? mockEngagement.gruve;

  const unread = items.filter((i) => !i.read).length;
  const unreplied = items.filter((i) => !i.replied).length;
  const dms = items.filter((i) => i.type === "dm").length;
  const mentions = items.filter((i) => i.type === "mention").length;

  const typeIcons: Record<string, string> = { dm: "✉", comment: "💬", mention: "@", reply: "↩" };
  const platformColors: Record<string, string> = { instagram: "text-accent-purple", tiktok: "text-accent-pink", twitter: "text-status-teal", linkedin: "text-blue-400" };
  const sentimentColors: Record<string, string> = { positive: "bg-status-green/10 text-status-green", neutral: "bg-border/50 text-text-muted", negative: "bg-status-red/10 text-status-red", question: "bg-status-yellow/10 text-status-yellow" };

  return (
    <div className="p-8 max-w-[1200px]">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Engagement Inbox</h1>
          <p className="text-text-secondary text-sm mt-0.5">Comments, DMs, and mentions across all platforms</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Unread</p>
          <p className="text-2xl font-bold text-status-red mt-1">{unread}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Needs Reply</p>
          <p className="text-2xl font-bold text-status-yellow mt-1">{unreplied}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">DMs</p>
          <p className="text-2xl font-bold text-white mt-1">{dms}</p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <p className="text-text-secondary text-xs">Mentions</p>
          <p className="text-2xl font-bold text-accent-purple mt-1">{mentions}</p>
        </div>
      </div>

      {/* Inbox */}
      <div className="bg-card rounded-xl border border-border/50 overflow-hidden">
        <div className="divide-y divide-border/30">
          {items.map((item) => (
            <div key={item.id} className={`p-5 hover:bg-card-hover transition-colors ${!item.read ? "bg-accent-purple/[0.02]" : ""}`}>
              <div className="flex items-start gap-4">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-background flex items-center justify-center text-lg flex-shrink-0">
                  {item.from.avatarEmoji}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white text-sm font-semibold">{item.from.name}</span>
                    <span className="text-text-muted text-xs">{item.from.handle}</span>
                    <span className="text-text-muted text-xs">·</span>
                    <span className={`text-xs font-medium ${platformColors[item.platform]}`}>{item.platform}</span>
                    <span className="text-text-muted text-xs">·</span>
                    <span className="text-text-muted text-xs">{item.timestamp}</span>
                    {!item.read && <span className="w-2 h-2 rounded-full bg-accent-purple flex-shrink-0" />}
                  </div>

                  <p className="text-text-secondary text-sm leading-relaxed">{item.content}</p>

                  {item.postTitle && (
                    <p className="text-text-muted text-xs mt-1">
                      On: <span className="text-text-secondary">{item.postTitle}</span>
                    </p>
                  )}

                  {/* Actions row */}
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-background text-text-muted">{typeIcons[item.type]} {item.type}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${sentimentColors[item.sentiment]}`}>{item.sentiment}</span>
                    {item.replied ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-status-green/10 text-status-green">replied</span>
                    ) : (
                      <button className="text-[10px] px-2 py-1 rounded bg-accent-purple/10 text-accent-purple hover:bg-accent-purple/20 transition-colors font-medium">
                        Reply
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
