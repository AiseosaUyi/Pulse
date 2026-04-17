"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import Link from "next/link";
import { mockNotifications, type Notification } from "@/lib/data/mock-engagement";

interface NotificationBellProps {
  tenantSlug: string;
}

const typeStyles: Record<string, { bg: string; icon: string }> = {
  warning: { bg: "bg-status-red/10", icon: "⚠" },
  opportunity: { bg: "bg-status-green/10", icon: "★" },
  action: { bg: "bg-status-yellow/10", icon: "!" },
  info: { bg: "bg-primary-500/10", icon: "i" },
};

export function NotificationBell({ tenantSlug }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const notifications = mockNotifications[tenantSlug] ?? mockNotifications.gruve;
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg border border-border hover:bg-card-hover transition-colors"
      >
        <Bell size={18} className="text-text-secondary" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary-500 flex items-center justify-center text-[9px] font-bold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="fixed inset-x-4 top-16 md:absolute md:inset-x-auto md:right-0 md:top-full mt-2 md:w-[380px] bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
            <div className="p-4 border-b border-border/50 flex items-center justify-between">
              <h3 className="text-foreground font-semibold text-sm">Notifications</h3>
              <span className="text-text-muted text-xs">{unreadCount} unread</span>
            </div>
            <div className="max-h-[420px] overflow-y-auto divide-y divide-border/20">
              {notifications.map((n) => (
                <Link
                  key={n.id}
                  href={n.actionUrl}
                  onClick={() => setIsOpen(false)}
                  className={`block p-4 hover:bg-card-hover transition-colors ${!n.read ? "bg-primary-500/[0.04]" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-7 h-7 rounded-full ${typeStyles[n.type].bg} flex items-center justify-center text-xs flex-shrink-0`}>
                      {typeStyles[n.type].icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium ${!n.read ? "text-foreground" : "text-text-secondary"}`}>{n.title}</p>
                        {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-primary-500 flex-shrink-0" />}
                      </div>
                      <p className="text-text-muted text-xs mt-0.5 line-clamp-2">{n.description}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-text-muted text-[10px]">{n.timestamp}</span>
                        <span className="text-primary-500 text-[10px] font-medium">{n.actionLabel} →</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
