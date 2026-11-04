"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  HelpCircle,
  ExternalLink,
  Flame,
  Filter,
} from "lucide-react";
import type {
  LinkedType,
  OccurrenceStatus,
  TaskOccurrence,
  TaskPriority,
  TeamPerson,
} from "@/lib/types/tasks";

interface BoardTabProps {
  occurrences: TaskOccurrence[];
  people: TeamPerson[];
  onOpenTask: (occurrence: TaskOccurrence) => void;
}

export function BoardTab({ occurrences, people, onOpenTask }: BoardTabProps) {
  // Filter states
  const [filterPerson, setFilterPerson] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterTag, setFilterTag] = useState<string>("all");
  const [filterLinked, setFilterLinked] = useState<string>("all");

  // Extract all unique tags
  const allTags = Array.from(
    new Set(occurrences.flatMap((o) => o.task?.tags ?? []))
  ).sort();

  // Filter occurrences
  const filtered = occurrences.filter((occ) => {
    if (filterPerson !== "all" && occ.ownerPersonId !== filterPerson) return false;
    if (filterPriority !== "all" && occ.task?.priority !== filterPriority) return false;
    if (filterTag !== "all" && !(occ.task?.tags ?? []).includes(filterTag)) return false;
    if (filterLinked !== "all" && occ.task?.linkedType !== filterLinked) return false;
    return true;
  });

  // Categorize into 4 Kanban columns
  const todoList = filtered.filter((o) => o.status === "pending");
  const doneList = filtered.filter((o) => o.status === "done");
  const missedList = filtered.filter((o) => o.status === "missed");
  const excusedList = filtered.filter((o) => o.status === "excused");

  const columns = [
    {
      id: "todo",
      label: "To do",
      color: "border-primary-500/30 text-primary-500",
      items: todoList,
      icon: Clock,
    },
    {
      id: "done",
      label: "Done (this week)",
      color: "border-success-500/30 text-success-500",
      items: doneList,
      icon: CheckCircle2,
    },
    {
      id: "missed",
      label: "Missed (breaches)",
      color: "border-error-500/30 text-error-500",
      items: missedList,
      icon: AlertCircle,
    },
    {
      id: "excused",
      label: "Excused",
      color: "border-gray-500/30 text-text-muted",
      items: excusedList,
      icon: HelpCircle,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-border bg-card">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted pr-2 border-r border-border">
          <Filter size={13} />
          Filters:
        </div>

        {/* Person filter */}
        <select
          value={filterPerson}
          onChange={(e) => setFilterPerson(e.target.value)}
          className="h-8 px-2.5 rounded-lg border border-border bg-background text-foreground text-xs focus:ring-1 focus:ring-primary-500"
        >
          <option value="all">All People</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {/* Priority filter */}
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="h-8 px-2.5 rounded-lg border border-border bg-background text-foreground text-xs focus:ring-1 focus:ring-primary-500"
        >
          <option value="all">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>

        {/* Tag filter */}
        {allTags.length > 0 && (
          <select
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            className="h-8 px-2.5 rounded-lg border border-border bg-background text-foreground text-xs focus:ring-1 focus:ring-primary-500"
          >
            <option value="all">All Tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
        )}

        {/* Linked type filter */}
        <select
          value={filterLinked}
          onChange={(e) => setFilterLinked(e.target.value)}
          className="h-8 px-2.5 rounded-lg border border-border bg-background text-foreground text-xs focus:ring-1 focus:ring-primary-500"
        >
          <option value="all">All Types</option>
          <option value="prospect">Prospect</option>
          <option value="event">Event</option>
          <option value="post">Post</option>
          <option value="campaign">Campaign</option>
        </select>

        {(filterPerson !== "all" ||
          filterPriority !== "all" ||
          filterTag !== "all" ||
          filterLinked !== "all") && (
          <button
            type="button"
            onClick={() => {
              setFilterPerson("all");
              setFilterPriority("all");
              setFilterTag("all");
              setFilterLinked("all");
            }}
            className="text-xs text-primary-500 hover:underline font-medium ml-auto"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Board Columns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
        {columns.map((col) => {
          const Icon = col.icon;
          return (
            <div
              key={col.id}
              className="rounded-2xl border border-border bg-card flex flex-col max-h-[calc(100vh-220px)] overflow-hidden"
            >
              {/* Column Header */}
              <div className="p-3.5 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon size={14} className={col.color} />
                  <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                    {col.label}
                  </span>
                </div>
                <span className="text-xs font-bold text-text-muted bg-background px-2 py-0.5 rounded-full border border-border">
                  {col.items.length}
                </span>
              </div>

              {/* Cards List */}
              <div className="p-3 overflow-y-auto space-y-2.5 flex-1">
                {col.items.length === 0 ? (
                  <p className="text-center text-text-muted text-xs py-8">
                    No tasks
                  </p>
                ) : (
                  col.items.map((occ) => (
                    <div
                      key={occ.id}
                      onClick={() => onOpenTask(occ)}
                      className="p-3 rounded-xl border border-border bg-background hover:border-primary-500/50 hover:shadow-xs transition-all cursor-pointer space-y-2 select-none group"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                          {occ.occursOn}
                        </span>
                        {occ.task?.priority && occ.task.priority !== "normal" && (
                          <span
                            className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded-full border ${
                              occ.task.priority === "urgent"
                                ? "bg-error-500/10 text-error-500 border-error-500/20"
                                : "bg-warning-50 text-warning-500 border-warning-500/20"
                            }`}
                          >
                            {occ.task.priority}
                          </span>
                        )}
                      </div>

                      <h4 className="text-xs font-bold text-foreground group-hover:text-primary-500 transition-colors line-clamp-2">
                        {occ.task?.title ?? "Task"}
                      </h4>

                      <div className="flex items-center justify-between text-[11px] text-text-muted pt-1 border-t border-border/50">
                        <span className="font-medium text-foreground truncate max-w-[120px]">
                          {occ.owner?.name ?? "Team member"}
                        </span>

                        {occ.task?.tags && occ.task.tags.length > 0 && (
                          <span className="text-[10px] text-text-muted">
                            #{occ.task.tags[0]}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
