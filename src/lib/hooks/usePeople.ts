"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { TeamPerson } from "@/lib/types/tasks";
import { listPeopleAction } from "@/lib/actions/people";

export interface PeopleHookResult {
  people: TeamPerson[];
  activePeople: TeamPerson[];
  tagGroups: string[];
  currentUserId: string | null;
  currentUserPerson: TeamPerson | null;
  isAdmin: boolean;
  selectedAssignee: string; // "me" | "all" | "unassigned" | person.id | `tag:${string}`
  setSelectedAssignee: (val: string) => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  resolvePerson: (idOrName: string | null | undefined) => TeamPerson | null;
}

export function usePeople(tenantSlug?: string): PeopleHookResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [people, setPeople] = useState<TeamPerson[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPeople = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await listPeopleAction(tenantSlug);
      if (res) {
        setPeople(res.people);
        setCurrentUserId(res.currentUserId);
        setIsAdmin(res.isAdmin);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load people");
    } finally {
      setLoading(false);
    }
  }, [tenantSlug]);

  useEffect(() => {
    fetchPeople();
  }, [fetchPeople]);

  const activePeople = useMemo(() => people.filter((p) => p.active), [people]);

  const tagGroups = useMemo(() => {
    const set = new Set<string>();
    for (const p of activePeople) {
      for (const t of p.tags || []) {
        if (t.trim()) set.add(t.trim().toLowerCase());
      }
    }
    return Array.from(set).sort();
  }, [activePeople]);

  const currentUserPerson = useMemo(() => {
    if (!currentUserId) return null;
    return people.find((p) => p.userId === currentUserId) ?? null;
  }, [people, currentUserId]);

  // Default assignee is "me" for members and "all" (Everyone) for admins
  const defaultAssignee = isAdmin ? "all" : "me";

  // URL query parameter ?assignee=
  const urlAssignee = searchParams.get("assignee");
  const selectedAssignee = urlAssignee || defaultAssignee;

  const setSelectedAssignee = useCallback(
    (newVal: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (newVal === defaultAssignee) {
        params.delete("assignee");
      } else {
        params.set("assignee", newVal);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, defaultAssignee, pathname, router]
  );

  const resolvePerson = useCallback(
    (idOrName: string | null | undefined): TeamPerson | null => {
      if (!idOrName) return null;
      const lower = idOrName.toLowerCase().trim();
      return (
        people.find((p) => p.id === idOrName || p.name.toLowerCase().trim() === lower) ?? null
      );
    },
    [people]
  );

  return {
    people,
    activePeople,
    tagGroups,
    currentUserId,
    currentUserPerson,
    isAdmin,
    selectedAssignee,
    setSelectedAssignee,
    loading,
    error,
    refresh: fetchPeople,
    resolvePerson,
  };
}
