import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const taskPrioritySchema = z.enum(["urgent", "high", "normal", "low"]);
export const taskKindSchema = z.enum(["one_off", "recurring"]);
export const recurrenceFrequencySchema = z.enum(["daily", "weekdays", "weekly", "monthly"]);
export const proofRequiredSchema = z.enum(["none", "link", "note", "image"]);
export const taskStatusSchema = z.enum(["active", "paused", "archived"]);

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required"),
    description: z.string().trim().nullable().optional(),
    ownerPersonId: z.string().uuid().nullable().optional(),
    priority: taskPrioritySchema.default("normal"),
    kind: taskKindSchema.default("recurring"),
    startDate: z.string().regex(dateRegex, "startDate must be YYYY-MM-DD"),
    endDate: z.string().regex(dateRegex, "endDate must be YYYY-MM-DD").nullable().optional(),
    dueDate: z.string().regex(dateRegex, "dueDate must be YYYY-MM-DD").nullable().optional(),
    dueTime: z.string().nullable().optional(),
    recurrence: recurrenceFrequencySchema.nullable().optional(),
    recurrenceDays: z.array(z.number().int().min(1).max(7)).nullable().optional(),
    recurrenceMonthDay: z.number().int().min(1).max(31).nullable().optional(),
    proofRequired: proofRequiredSchema.default("none"),
    proofHint: z.string().trim().nullable().optional(),
    metricLabel: z.string().trim().nullable().optional(),
    metricTarget: z.number().nullable().optional(),
    linkedType: z.string().nullable().optional(),
    linkedId: z.string().nullable().optional(),
    tags: z.array(z.string().trim()).default([]),
    checklist: z.array(z.string().trim()).default([]),
    status: taskStatusSchema.default("active"),
    pausedUntil: z.string().regex(dateRegex).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // 1. end_date >= start_date
    if (data.endDate && data.endDate < data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must be on or after start date",
        path: ["endDate"],
      });
    }

    // 2. Schedule requirements per kind
    if (data.kind === "one_off") {
      if (!data.dueDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "One-off tasks require a due date",
          path: ["dueDate"],
        });
      }
    } else if (data.kind === "recurring") {
      if (!data.recurrence) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Recurring tasks require a recurrence frequency",
          path: ["recurrence"],
        });
      }
      if (data.recurrence === "weekly") {
        if (!data.recurrenceDays || data.recurrenceDays.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Weekly recurring tasks require at least one weekday",
            path: ["recurrenceDays"],
          });
        }
      }
      if (data.recurrence === "monthly") {
        if (!data.recurrenceMonthDay) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Monthly recurring tasks require a day of the month (1-31)",
            path: ["recurrenceMonthDay"],
          });
        }
      }
      // Recurring tasks without an owner must be paused
      if (!data.ownerPersonId && data.status !== "paused") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Recurring tasks without an owner must be paused",
          path: ["status"],
        });
      }
    }
  });

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().nullable().optional(),
    ownerPersonId: z.string().uuid().nullable().optional(),
    priority: taskPrioritySchema.optional(),
    kind: taskKindSchema.optional(),
    startDate: z.string().regex(dateRegex).optional(),
    endDate: z.string().regex(dateRegex).nullable().optional(),
    dueDate: z.string().regex(dateRegex).nullable().optional(),
    dueTime: z.string().nullable().optional(),
    recurrence: recurrenceFrequencySchema.nullable().optional(),
    recurrenceDays: z.array(z.number().int().min(1).max(7)).nullable().optional(),
    recurrenceMonthDay: z.number().int().min(1).max(31).nullable().optional(),
    proofRequired: proofRequiredSchema.optional(),
    proofHint: z.string().trim().nullable().optional(),
    metricLabel: z.string().trim().nullable().optional(),
    metricTarget: z.number().nullable().optional(),
    linkedType: z.string().nullable().optional(),
    linkedId: z.string().nullable().optional(),
    tags: z.array(z.string().trim()).optional(),
    checklist: z.array(z.string().trim()).optional(),
    status: taskStatusSchema.optional(),
    pausedUntil: z.string().regex(dateRegex).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.endDate && data.endDate < data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must be on or after start date",
        path: ["endDate"],
      });
    }
    if (data.recurrence === "weekly" && data.recurrenceDays !== undefined) {
      if (!data.recurrenceDays || data.recurrenceDays.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Weekly recurring tasks require at least one weekday",
          path: ["recurrenceDays"],
        });
      }
    }
  });

export type CreateTaskValidatedInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskValidatedInput = z.infer<typeof updateTaskSchema>;
