"use server";

import { revalidatePath } from "next/cache";
import { getCurrentTenant, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CreateTaskInput, UpdateTaskInput } from "@/lib/types/tasks";
import { createTaskSchema, updateTaskSchema } from "@/lib/validation/tasks";
import {
  addTaskComment,
  archiveTask,
  completeOccurrence,
  createTask,
  createTeamPerson,
  excuseOccurrence,
  getTaskById,
  recordPersonLeave,
  approvePersonLeave,
  declinePersonLeave,
  cancelPersonLeave,
  toggleChecklistItem,
  uncompleteOccurrence,
  updateTask,
} from "@/lib/services/tasks";

function checkIsAdmin(role: string): boolean {
  return role === "owner" || role === "admin";
}

export async function createTaskAction(input: CreateTaskInput) {
  const user = await requireUser();
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { success: false, error: "No active tenant" };

  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid task data" };
  }

  const tenantSlug = currentTenant.slug;
  const isAdmin = checkIsAdmin(currentTenant.role);

  // Members can create tasks for themselves, admins can create for anyone
  const supabase = createAdminClient();

  if (!isAdmin && input.ownerPersonId) {
    // If member, verify that owner_person_id links to their own user_id
    const { data: person } = await supabase
      .from("team_people")
      .select("user_id")
      .eq("id", input.ownerPersonId)
      .eq("tenant_slug", tenantSlug)
      .single();

    if (person?.user_id !== user.id) {
      return { success: false, error: "Members can only create tasks for themselves" };
    }
  }

  try {
    const task = await createTask(supabase, tenantSlug, input, user.id);
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    return { success: true, task };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create task";
    return { success: false, error: message };
  }
}

export async function updateTaskAction(taskId: string, input: UpdateTaskInput) {
  const user = await requireUser();
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { success: false, error: "No active tenant" };

  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid update data" };
  }

  const tenantSlug = currentTenant.slug;
  const isAdmin = checkIsAdmin(currentTenant.role);
  const supabase = createAdminClient();

  const existing = await getTaskById(supabase, tenantSlug, taskId);
  if (!existing) return { success: false, error: "Task not found" };

  // Permission check: admin or owner of task (C7)
  if (!isAdmin) {
    const { data: ownerPerson } = await supabase
      .from("team_people")
      .select("user_id")
      .eq("id", existing.ownerPersonId)
      .single();

    if (ownerPerson?.user_id !== user.id) {
      return { success: false, error: "Only admins or task owners can edit this task" };
    }

    // Restrict ownerPersonId and priority changes to admins (C7)
    if (input.ownerPersonId !== undefined && input.ownerPersonId !== existing.ownerPersonId) {
      return { success: false, error: "Only admins can reassign tasks to another person" };
    }
    if (input.priority !== undefined && input.priority !== existing.priority) {
      return { success: false, error: "Only admins can change task priority" };
    }
  }

  try {
    const task = await updateTask(supabase, tenantSlug, taskId, input, user.id);
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    return { success: true, task };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update task";
    return { success: false, error: message };
  }
}

export async function archiveTaskAction(taskId: string) {
  const user = await requireUser();
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { success: false, error: "No active tenant" };

  if (!checkIsAdmin(currentTenant.role)) {
    return { success: false, error: "Only admins can archive tasks" };
  }

  const supabase = createAdminClient();
  try {
    await archiveTask(supabase, currentTenant.slug, taskId, user.id);
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to archive task";
    return { success: false, error: message };
  }
}

export async function completeOccurrenceAction(params: {
  occurrenceId: string;
  proofUrl?: string | null;
  proofNote?: string | null;
  proofImagePath?: string | null;
  metricValue?: number | null;
}) {
  const user = await requireUser();
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { success: false, error: "No active tenant" };

  const supabase = createAdminClient();
  const isAdmin = checkIsAdmin(currentTenant.role);

  const result = await completeOccurrence(supabase, currentTenant.slug, {
    occurrenceId: params.occurrenceId,
    completedBy: user.id,
    isAdmin,
    proofUrl: params.proofUrl,
    proofNote: params.proofNote,
    proofImagePath: params.proofImagePath,
    metricValue: params.metricValue,
  });

  if (!result.ok) {
    return { success: false, error: result.error ?? "Failed to complete task" };
  }

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function uncompleteOccurrenceAction(occurrenceId: string) {
  const user = await requireUser();
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { success: false, error: "No active tenant" };

  const supabase = createAdminClient();
  const isAdmin = checkIsAdmin(currentTenant.role);

  const result = await uncompleteOccurrence(
    supabase,
    currentTenant.slug,
    occurrenceId,
    user.id,
    isAdmin
  );

  if (!result.ok) {
    return { success: false, error: result.error ?? "Failed to uncomplete task" };
  }

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function excuseOccurrenceAction(occurrenceId: string, reason: string) {
  const user = await requireUser();
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { success: false, error: "No active tenant" };

  if (!checkIsAdmin(currentTenant.role)) {
    return { success: false, error: "Only admins can excuse missed tasks" };
  }

  const supabase = createAdminClient();
  const result = await excuseOccurrence(
    supabase,
    currentTenant.slug,
    occurrenceId,
    user.id,
    reason
  );

  if (!result.ok) {
    return { success: false, error: result.error ?? "Failed to excuse task" };
  }

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function toggleCheckAction(checkId: string, checked: boolean) {
  const user = await requireUser();
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { success: false, error: "No active tenant" };

  const isAdmin = checkIsAdmin(currentTenant.role);
  const supabase = createAdminClient();
  const result = await toggleChecklistItem(supabase, currentTenant.slug, checkId, checked, user.id, isAdmin);
  if (!result.ok) {
    return { success: false, error: result.error ?? "Failed to toggle check item" };
  }
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function addCommentAction(
  taskId: string,
  occurrenceIdOrBody: string | null,
  body?: string
) {
  const user = await requireUser();
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { success: false, error: "No active tenant" };

  const occurrenceId = body !== undefined ? occurrenceIdOrBody : null;
  const commentBody = body !== undefined ? body : (occurrenceIdOrBody ?? "");

  const supabase = createAdminClient();
  try {
    const comment = await addTaskComment(supabase, currentTenant.slug, {
      taskId,
      occurrenceId,
      author: user.id,
      body: commentBody,
    });
    revalidatePath("/tasks");
    return { success: true, comment };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to add comment";
    return { success: false, error: message };
  }
}

export async function recordLeaveAction(params: {
  personId: string;
  startsOn: string;
  endsOn: string;
  reason?: string | null;
}) {
  const user = await requireUser();
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { success: false, error: "No active tenant" };

  if (params.startsOn > params.endsOn) {
    return { success: false, error: "Leave start date must be on or before end date" };
  }

  const supabase = createAdminClient();
  const isAdmin = checkIsAdmin(currentTenant.role);

  if (!isAdmin) {
    const { data: person } = await supabase
      .from("team_people")
      .select("user_id")
      .eq("id", params.personId)
      .single();

    if (person?.user_id !== user.id) {
      return { success: false, error: "You can only request leave for yourself" };
    }
  }

  try {
    const leave = await recordPersonLeave(supabase, currentTenant.slug, {
      ...params,
      createdBy: user.id,
      status: isAdmin ? "approved" : "requested",
    });
    revalidatePath("/tasks");
    return { success: true, leave };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record leave";
    return { success: false, error: message };
  }
}

export async function approveLeaveAction(leaveId: string) {
  const user = await requireUser();
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { success: false, error: "No active tenant" };
  if (!checkIsAdmin(currentTenant.role)) return { success: false, error: "Only admins can approve leave" };

  const supabase = createAdminClient();
  try {
    await approvePersonLeave(supabase, currentTenant.slug, leaveId, user.id);
    revalidatePath("/tasks");
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to approve leave";
    return { success: false, error: message };
  }
}

export async function declineLeaveAction(leaveId: string) {
  const user = await requireUser();
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { success: false, error: "No active tenant" };
  if (!checkIsAdmin(currentTenant.role)) return { success: false, error: "Only admins can decline leave" };

  const supabase = createAdminClient();
  try {
    await declinePersonLeave(supabase, currentTenant.slug, leaveId, user.id);
    revalidatePath("/tasks");
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to decline leave";
    return { success: false, error: message };
  }
}

export async function cancelLeaveAction(leaveId: string) {
  const user = await requireUser();
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { success: false, error: "No active tenant" };
  const isAdmin = checkIsAdmin(currentTenant.role);

  const supabase = createAdminClient();
  try {
    await cancelPersonLeave(supabase, currentTenant.slug, leaveId, user.id, isAdmin);
    revalidatePath("/tasks");
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to cancel leave";
    return { success: false, error: message };
  }
}

export async function createTeamPersonAction(params: {
  name: string;
  userId?: string | null;
  leadPersonId?: string | null;
}) {
  await requireUser();
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { success: false, error: "No active tenant" };

  if (!checkIsAdmin(currentTenant.role)) {
    return { success: false, error: "Only admins can add team members" };
  }

  const supabase = createAdminClient();
  try {
    const person = await createTeamPerson(supabase, currentTenant.slug, params);
    revalidatePath("/tasks");
    return { success: true, person };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create team person";
    return { success: false, error: message };
  }
}

export async function getSignedProofUploadUrlAction(filename: string) {
  await requireUser();
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { success: false, error: "No active tenant" };

  const adminClient = createAdminClient();
  const safeFilename = `${crypto.randomUUID()}-${filename.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
  const path = `${currentTenant.slug}/${safeFilename}`;

  const { data, error } = await adminClient.storage
    .from("task-proofs")
    .createSignedUploadUrl(path);

  if (error || !data) {
    return {
      success: false,
      error: error?.message ?? "Could not generate upload URL",
    };
  }

  return {
    success: true,
    path,
    uploadUrl: data.signedUrl,
    token: data.token,
  };
}

export async function getSignedProofViewUrlAction(path: string) {
  await requireUser();
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { success: false, error: "No active tenant" };

  // Verify path belongs to current tenant
  if (!path.startsWith(`${currentTenant.slug}/`)) {
    return { success: false, error: "Unauthorized path" };
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient.storage
    .from("task-proofs")
    .createSignedUrl(path, 3600); // 1 hour

  if (error || !data) {
    return { success: false, error: error?.message ?? "Could not generate view URL" };
  }

  return { success: true, signedUrl: data.signedUrl };
}
