"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  CalendarCheck,
  LayoutGrid,
  Flame,
  FileSpreadsheet,
  CalendarOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TodayTab } from "./TodayTab";
import { BoardTab } from "./BoardTab";
import { StreaksTab } from "./StreaksTab";
import { StandupTab } from "./StandupTab";
import { TaskDrawer } from "./TaskDrawer";
import { LeaveModal } from "./LeaveModal";
import type {
  PersonStreakGroup,
  StandupReport,
  Task,
  TaskOccurrence,
  TeamPerson,
} from "@/lib/types/tasks";

interface TasksViewProps {
  initialTab?: string;
  people: TeamPerson[];
  overdueOccurrences: TaskOccurrence[];
  todayOccurrences: TaskOccurrence[];
  boardOccurrences: TaskOccurrence[];
  streakGroups: PersonStreakGroup[];
  breaches: TaskOccurrence[];
  standupReport: StandupReport;
  streaksByTaskId: Record<string, number>;
  isAdmin: boolean;
  currentUserId: string;
  tenantSlug: string;
}

export function TasksView({
  initialTab = "today",
  people,
  overdueOccurrences,
  todayOccurrences,
  boardOccurrences,
  streakGroups,
  breaches,
  standupReport,
  streaksByTaskId,
  isAdmin,
  currentUserId,
  tenantSlug,
}: TasksViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab") || initialTab;

  // Selected person for Today tab: default to "everyone" for admin, "me" for member
  const [selectedPersonId, setSelectedPersonId] = useState<string>(
    isAdmin ? "everyone" : "me"
  );

  // Drawer & Leave Modal states
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);

  const setTab = (tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/tasks?${params.toString()}`);
  };

  const handleOpenCreate = () => {
    setEditingTask(null);
    setIsDrawerOpen(true);
  };

  const handleOpenEditFromOccurrence = (occ: TaskOccurrence) => {
    if (occ.task) {
      setEditingTask(occ.task);
      setIsDrawerOpen(true);
    }
  };

  const handleOpenEditFromTaskId = (taskId: string) => {
    // Find task in occurrences or streaks
    for (const g of streakGroups) {
      const t = g.tasks.find((r) => r.task.id === taskId);
      if (t) {
        setEditingTask(t.task);
        setIsDrawerOpen(true);
        return;
      }
    }
  };

  const tabs = [
    { id: "today", label: "Today", icon: CalendarCheck },
    { id: "board", label: "Board", icon: LayoutGrid },
    { id: "streaks", label: "Streaks & Breaches", icon: Flame },
    { id: "standup", label: "Standup Report", icon: FileSpreadsheet },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Tasks & Habits</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Team habits, daily checklists, streaks and accountability.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsLeaveModalOpen(true)}
            className="flex items-center gap-1.5 text-xs h-9"
          >
            <CalendarOff size={13} />
            Record Leave
          </Button>

          <Button
            onClick={handleOpenCreate}
            size="sm"
            className="flex items-center gap-1.5 text-xs h-9 bg-primary-500 hover:bg-primary-600 font-semibold"
          >
            <Plus size={15} />
            New Task
          </Button>
        </div>
      </div>

      {/* Primary Tab Navigation */}
      <div className="border-b border-border flex items-center gap-1 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                isActive
                  ? "border-primary-500 text-foreground"
                  : "border-transparent text-text-muted hover:text-foreground"
              }`}
            >
              <Icon
                size={14}
                className={isActive ? "text-primary-500" : "text-text-muted"}
              />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      {currentTab === "today" && (
        <TodayTab
          overdueOccurrences={overdueOccurrences}
          todayOccurrences={todayOccurrences}
          people={people}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          selectedPersonId={selectedPersonId}
          onSelectPerson={setSelectedPersonId}
          onEditTask={handleOpenEditFromOccurrence}
          streaksByTaskId={streaksByTaskId}
        />
      )}

      {currentTab === "board" && (
        <BoardTab
          occurrences={boardOccurrences}
          people={people}
          onOpenTask={handleOpenEditFromOccurrence}
        />
      )}

      {currentTab === "streaks" && (
        <StreaksTab
          groups={streakGroups}
          breaches={breaches}
          isAdmin={isAdmin}
          onOpenTask={handleOpenEditFromTaskId}
        />
      )}

      {currentTab === "standup" && (
        <StandupTab
          initialReport={standupReport}
          people={people}
          tenantSlug={tenantSlug}
        />
      )}

      {/* Task Drawer */}
      <TaskDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        task={editingTask}
        people={people}
        isAdmin={isAdmin}
        currentUserId={currentUserId}
        defaultPersonId={selectedPersonId !== "me" && selectedPersonId !== "everyone" ? selectedPersonId : undefined}
      />

      {/* Leave Modal */}
      <LeaveModal
        isOpen={isLeaveModalOpen}
        onClose={() => setIsLeaveModalOpen(false)}
        people={people}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
      />
    </div>
  );
}
