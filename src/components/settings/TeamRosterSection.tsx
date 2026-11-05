"use client";

import { useState, useTransition } from "react";
import { UserCheck, Plus, Trash2, Edit2, Check, X, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/Toaster";
import type { TeamMemberRecord, WeeklyTargets } from "@/lib/types/team";
import {
  saveTeamMember,
  deleteTeamMemberAction,
  updateTeamMemberTargetsAction,
  toggleTeamMemberActiveAction,
  linkPersonToUserAction,
} from "@/app/(app)/settings/actions";

export interface LoginMemberInfo {
  userId: string;
  displayName: string;
  username: string;
  role: string;
}

export function TeamRosterSection({
  members: initialMembers,
  tenantSlug,
  loginMembers = [],
}: {
  members: TeamMemberRecord[];
  tenantSlug: string;
  loginMembers?: LoginMemberInfo[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newTargets, setNewTargets] = useState<WeeklyTargets>({
    eventsCreated: 0,
    conversations: 0,
    reachOuts: 0,
    organicDms: 0,
  });
  const [editTargets, setEditTargets] = useState<WeeklyTargets>({});
  const [isPending, startTransition] = useTransition();

  const handleLinkUser = (personId: string, userId: string | null) => {
    startTransition(async () => {
      const res = await linkPersonToUserAction(personId, userId);
      if (res.success) {
        setMembers((prev) =>
          prev.map((m) => (m.id === personId ? { ...m, userId } : m))
        );
        toast.success(userId ? "Person linked to login" : "Login unlinked");
      } else {
        toast.error("Failed to link person", res.message);
      }
    });
  };

  const handleToggleActive = (member: TeamMemberRecord) => {
    const nextActive = !member.active;
    startTransition(async () => {
      setMembers((prev) =>
        prev.map((m) => (m.id === member.id ? { ...m, active: nextActive } : m))
      );
      const res = await toggleTeamMemberActiveAction(member.id, nextActive);
      if (!res.success) {
        toast.error("Failed to update status", res.message);
        setMembers((prev) =>
          prev.map((m) => (m.id === member.id ? { ...m, active: member.active } : m))
        );
      } else {
        toast.success(nextActive ? "Member activated" : "Member deactivated");
      }
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      const prev = members;
      setMembers((p) => p.filter((m) => m.id !== id));
      const res = await deleteTeamMemberAction(id);
      if (!res.success) {
        toast.error("Failed to delete", res.message);
        setMembers(prev);
      } else {
        toast.success("Team member removed");
      }
    });
  };

  const handleSaveAdd = () => {
    if (!newName.trim()) {
      toast.error("Name is required");
      return;
    }
    const fd = new FormData();
    fd.append("name", newName);
    fd.append("role", newRole || "Member");
    fd.append("active", "true");
    fd.append("eventsCreated", String(newTargets.eventsCreated || 0));
    fd.append("conversations", String(newTargets.conversations || 0));
    fd.append("reachOuts", String(newTargets.reachOuts || 0));
    fd.append("organicDms", String(newTargets.organicDms || 0));

    startTransition(async () => {
      const res = await saveTeamMember(fd);
      if (res.success) {
        toast.success("Team member added");
        setIsAdding(false);
        setNewName("");
        setNewRole("");
        // Optimistic refresh
        setMembers((prev) => [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            tenantSlug,
            name: newName,
            role: newRole || "Member",
            active: true,
            weeklyTargets: newTargets,
            userId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]);
      } else {
        toast.error("Failed to add", res.message);
      }
    });
  };

  const handleSaveTargets = (member: TeamMemberRecord) => {
    startTransition(async () => {
      const res = await updateTeamMemberTargetsAction(member.id, editTargets);
      if (res.success) {
        toast.success("Targets updated");
        setMembers((prev) =>
          prev.map((m) => (m.id === member.id ? { ...m, weeklyTargets: editTargets } : m))
        );
        setEditingId(null);
      } else {
        toast.error("Failed to save targets", res.message);
      }
    });
  };

  return (
    <section className="bg-card border border-border rounded-2xl p-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <UserCheck size={18} className="text-primary-500" />
            Outbound & Sales Team
          </h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Team roster for assigning leads, action items, and tracking weekly performance scoreboard.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsAdding((v) => !v)}
          className="text-xs gap-1"
        >
          <Plus size={13} />
          Add team member
        </Button>
      </div>

      {isAdding && (
        <div className="p-4 mb-4 rounded-xl border border-primary-500/20 bg-primary-500/5 space-y-3">
          <p className="text-xs font-semibold text-foreground">New Team Member</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-text-muted">Name</label>
              <Input
                placeholder="e.g. Alex Morgan"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div>
              <label className="text-[11px] text-text-muted">Role</label>
              <Input
                placeholder="e.g. Partnerships and BD"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-text-muted flex items-center gap-1 mb-1">
              <Target size={11} /> Weekly Scoreboard Targets
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <span className="text-[10px] text-text-muted block">Events created</span>
                <Input
                  type="number"
                  placeholder="25"
                  value={newTargets.eventsCreated || ""}
                  onChange={(e) =>
                    setNewTargets((t) => ({ ...t, eventsCreated: Number(e.target.value) }))
                  }
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <span className="text-[10px] text-text-muted block">Conversations</span>
                <Input
                  type="number"
                  placeholder="40"
                  value={newTargets.conversations || ""}
                  onChange={(e) =>
                    setNewTargets((t) => ({ ...t, conversations: Number(e.target.value) }))
                  }
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <span className="text-[10px] text-text-muted block">Reach-outs</span>
                <Input
                  type="number"
                  placeholder="100"
                  value={newTargets.reachOuts || ""}
                  onChange={(e) =>
                    setNewTargets((t) => ({ ...t, reachOuts: Number(e.target.value) }))
                  }
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <span className="text-[10px] text-text-muted block">Organic DMs</span>
                <Input
                  type="number"
                  placeholder="20"
                  value={newTargets.organicDms || ""}
                  onChange={(e) =>
                    setNewTargets((t) => ({ ...t, organicDms: Number(e.target.value) }))
                  }
                  className="h-7 text-xs"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="xs" onClick={() => setIsAdding(false)}>
              Cancel
            </Button>
            <Button size="xs" onClick={handleSaveAdd} disabled={isPending}>
              Save member
            </Button>
          </div>
        </div>
      )}

      <ul className="divide-y divide-border/30">
        {members.map((member) => {
          const isEditing = editingId === member.id;
          return (
            <li key={member.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{member.name}</span>
                  <span className="text-xs text-text-muted px-2 py-0.5 rounded-full bg-sidebar">
                    {member.role}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(member)}
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                      member.active
                        ? "bg-status-green/10 text-status-green hover:bg-status-green/20"
                        : "bg-sidebar text-text-muted hover:bg-sidebar/80"
                    }`}
                  >
                    {member.active ? "Active" : "Inactive"}
                  </button>

                  {/* Admin link to login account control */}
                  {member.userId ? (
                    <div className="flex items-center gap-1.5 text-[11px] text-text-muted bg-sidebar/80 px-2 py-0.5 rounded-full border border-border/30">
                      <span className="text-status-green font-medium">● Linked</span>
                      <span>
                        {loginMembers.find((lm) => lm.userId === member.userId)?.displayName ?? "Login"}
                      </span>
                      <button
                        type="button"
                        title="Unlink login account"
                        aria-label="Unlink login account"
                        disabled={isPending}
                        onClick={() => handleLinkUser(member.id, null)}
                        className="text-text-muted hover:text-error-500 ml-0.5"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <select
                        aria-label="Link to login"
                        disabled={isPending}
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) handleLinkUser(member.id, e.target.value);
                        }}
                        className="text-[11px] h-6 bg-sidebar/80 border border-border/40 rounded px-1.5 text-text-muted hover:text-foreground focus:outline-none"
                      >
                        <option value="" disabled>Link to login…</option>
                        {loginMembers
                          .filter((lm) => !members.some((other) => other.userId === lm.userId && other.id !== member.id))
                          .map((lm) => (
                            <option key={lm.userId} value={lm.userId}>
                              {lm.displayName} ({lm.username || lm.role})
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="mt-2 p-2 rounded-lg bg-sidebar/50 border border-border/40 space-y-2">
                    <p className="text-[11px] font-medium text-foreground">Edit Weekly Targets:</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <span className="text-[10px] text-text-muted">Events</span>
                        <Input
                          type="number"
                          value={editTargets.eventsCreated || 0}
                          onChange={(e) =>
                            setEditTargets((t) => ({ ...t, eventsCreated: Number(e.target.value) }))
                          }
                          className="h-7 text-xs"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-text-muted">Conversations</span>
                        <Input
                          type="number"
                          value={editTargets.conversations || 0}
                          onChange={(e) =>
                            setEditTargets((t) => ({ ...t, conversations: Number(e.target.value) }))
                          }
                          className="h-7 text-xs"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-text-muted">Reach-outs</span>
                        <Input
                          type="number"
                          value={editTargets.reachOuts || 0}
                          onChange={(e) =>
                            setEditTargets((t) => ({ ...t, reachOuts: Number(e.target.value) }))
                          }
                          className="h-7 text-xs"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-text-muted">Organic DMs</span>
                        <Input
                          type="number"
                          value={editTargets.organicDms || 0}
                          onChange={(e) =>
                            setEditTargets((t) => ({ ...t, organicDms: Number(e.target.value) }))
                          }
                          className="h-7 text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-1.5 pt-1">
                      <Button variant="ghost" size="xs" onClick={() => setEditingId(null)}>
                        <X size={11} /> Cancel
                      </Button>
                      <Button size="xs" onClick={() => handleSaveTargets(member)} disabled={isPending}>
                        <Check size={11} /> Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-text-muted flex-wrap">
                    <span>Targets:</span>
                    {member.weeklyTargets.eventsCreated ? (
                      <span>{member.weeklyTargets.eventsCreated} events</span>
                    ) : null}
                    {member.weeklyTargets.conversations ? (
                      <span>{member.weeklyTargets.conversations} convos</span>
                    ) : null}
                    {member.weeklyTargets.reachOuts ? (
                      <span>{member.weeklyTargets.reachOuts} reach-outs</span>
                    ) : null}
                    {member.weeklyTargets.organicDms ? (
                      <span>{member.weeklyTargets.organicDms} organic DMs</span>
                    ) : null}
                    {!member.weeklyTargets.eventsCreated &&
                      !member.weeklyTargets.conversations &&
                      !member.weeklyTargets.reachOuts &&
                      !member.weeklyTargets.organicDms && <span>None set</span>}
                  </div>
                )}
              </div>

              {!isEditing && (
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setEditingId(member.id);
                      setEditTargets(member.weeklyTargets);
                    }}
                    title="Edit weekly targets"
                    className="text-text-muted hover:text-foreground"
                  >
                    <Edit2 size={12} />
                    Targets
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => handleDelete(member.id)}
                    title="Remove from roster"
                    className="text-text-muted hover:text-status-red"
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
