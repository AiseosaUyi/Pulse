"use client";

import React, { useState, useRef, useEffect } from "react";
import { User, Users, ChevronDown, Check, Tag, UserX } from "lucide-react";
import type { TeamPerson } from "@/lib/types/tasks";

export interface AssigneeOption {
  id: string; // "all", "me", "unassigned", or person.id, or "tag:<tag>"
  label: string;
  type: "system" | "person" | "tag";
  person?: TeamPerson;
  tag?: string;
}

export interface AssigneePickerProps {
  value: string | null; // person id, "all", "me", "unassigned", or "tag:<name>"
  onChange: (val: string) => void;
  people: TeamPerson[];
  tagGroups?: string[];
  currentUserPersonId?: string | null;
  mode?: "filter" | "assign"; // filter includes "Everyone", "Me", "tag:*" while assign is for setting a specific person or unassigned
  className?: string;
  size?: "sm" | "md";
  disabled?: boolean;
}

export function AssigneePicker({
  value,
  onChange,
  people,
  tagGroups = [],
  currentUserPersonId,
  mode = "filter",
  className = "",
  size = "md",
  disabled = false,
}: AssigneePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const activePeople = people.filter((p) => p.active);

  // Label calculation
  let currentLabel = "Unassigned";
  if (value === "all" || value === "everyone") {
    currentLabel = "Everyone";
  } else if (value === "me") {
    currentLabel = "Me";
  } else if (value === "unassigned" || !value) {
    currentLabel = "Unassigned";
  } else if (value.startsWith("tag:")) {
    const tagName = value.slice(4);
    currentLabel = `Tag: ${tagName.charAt(0).toUpperCase() + tagName.slice(1)}`;
  } else {
    const match = people.find((p) => p.id === value || p.name.toLowerCase() === value.toLowerCase());
    if (match) {
      currentLabel = match.name;
    } else {
      currentLabel = value;
    }
  }

  const handleSelect = (selectedId: string) => {
    onChange(selectedId);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative inline-block text-left ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center justify-between gap-2 rounded-xl border border-border bg-card text-foreground font-medium transition-colors hover:border-foreground/30 focus:outline-hidden focus:ring-1 focus:ring-ring disabled:opacity-50 ${
          size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm"
        }`}
      >
        <span className="flex items-center gap-1.5 truncate">
          {value === "all" || value === "everyone" ? (
            <Users size={14} className="text-text-muted" />
          ) : value === "unassigned" || !value ? (
            <UserX size={14} className="text-text-muted" />
          ) : value.startsWith("tag:") ? (
            <Tag size={14} className="text-text-muted" />
          ) : (
            <User size={14} className="text-text-muted" />
          )}
          <span className="truncate">{currentLabel}</span>
        </span>
        <ChevronDown size={14} className="text-text-muted shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-1.5 w-56 rounded-xl border border-border bg-popover p-1.5 shadow-xl text-xs sm:text-sm animate-in fade-in-0 zoom-in-95">
          {mode === "filter" && (
            <div className="border-b border-border/50 pb-1 mb-1">
              <button
                type="button"
                onClick={() => handleSelect("me")}
                className={`flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-left transition-colors hover:bg-muted ${
                  value === "me" ? "bg-muted font-bold text-foreground" : "text-foreground"
                }`}
              >
                <span className="flex items-center gap-2">
                  <User size={14} className="text-primary-500" />
                  <span>Me</span>
                </span>
                {value === "me" && <Check size={14} />}
              </button>

              <button
                type="button"
                onClick={() => handleSelect("all")}
                className={`flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-left transition-colors hover:bg-muted ${
                  value === "all" || value === "everyone"
                    ? "bg-muted font-bold text-foreground"
                    : "text-foreground"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Users size={14} className="text-primary-500" />
                  <span>Everyone</span>
                </span>
                {(value === "all" || value === "everyone") && <Check size={14} />}
              </button>
            </div>
          )}

          <div className="border-b border-border/50 pb-1 mb-1">
            <button
              type="button"
              onClick={() => handleSelect("unassigned")}
              className={`flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-left transition-colors hover:bg-muted ${
                value === "unassigned" || !value
                  ? "bg-muted font-bold text-foreground"
                  : "text-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <UserX size={14} className="text-text-muted" />
                <span>Unassigned</span>
              </span>
              {(value === "unassigned" || !value) && <Check size={14} />}
            </button>
          </div>

          {/* Active People */}
          <div className="max-h-48 overflow-y-auto py-1">
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Team Members
            </div>
            {activePeople.map((p) => {
              const isSelected = value === p.id || value === p.name;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelect(p.id)}
                  className={`flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-left transition-colors hover:bg-muted ${
                    isSelected ? "bg-muted font-bold text-foreground" : "text-foreground"
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <User size={14} className="text-text-muted shrink-0" />
                    <span className="truncate">{p.name}</span>
                    {p.tags?.includes("ambassador") && (
                      <span className="text-[10px] text-text-muted bg-card px-1.5 py-0.5 rounded-md border border-border">
                        Ambassador
                      </span>
                    )}
                  </span>
                  {isSelected && <Check size={14} className="shrink-0" />}
                </button>
              );
            })}
          </div>

          {/* Tag groups if in filter mode */}
          {mode === "filter" && tagGroups.length > 0 && (
            <div className="border-t border-border/50 pt-1 mt-1">
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                Tag Groups
              </div>
              {tagGroups.map((tg) => {
                const tagVal = `tag:${tg}`;
                const isSelected = value === tagVal;
                return (
                  <button
                    key={tg}
                    type="button"
                    onClick={() => handleSelect(tagVal)}
                    className={`flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-left transition-colors hover:bg-muted ${
                      isSelected ? "bg-muted font-bold text-foreground" : "text-foreground"
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Tag size={14} className="text-text-muted shrink-0" />
                      <span className="truncate capitalize">{tg}s</span>
                    </span>
                    {isSelected && <Check size={14} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
