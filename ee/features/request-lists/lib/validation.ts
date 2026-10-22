import { z } from "zod";

export const RequestTaskTypeSchema = z.enum(["TODO", "UPLOAD", "ACKNOWLEDGE"]);

export const RequestTaskStatusSchema = z.enum([
  "OPEN",
  "IN_PROGRESS",
  "SUBMITTED",
  "COMPLETED",
]);

export const RequestTaskAssignmentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("viewer"),
    viewerId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("group"),
    groupId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("link"),
    linkId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("email"),
    email: z.string().trim().email().max(320),
  }),
]);

export const CreateRequestTaskSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(10000).nullable().optional(),
  type: RequestTaskTypeSchema.default("TODO"),
  status: RequestTaskStatusSchema.default("OPEN"),
  category: z.string().trim().max(255).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  uploadFolderId: z.string().min(1).nullable().optional(),
  assignments: z.array(RequestTaskAssignmentSchema).max(500).default([]),
});

export const UpdateRequestTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(10000).nullable().optional(),
    type: RequestTaskTypeSchema.optional(),
    status: RequestTaskStatusSchema.optional(),
    category: z.string().trim().max(255).nullable().optional(),
    dueDate: z.string().nullable().optional(),
    uploadFolderId: z.string().min(1).nullable().optional(),
    assignments: z.array(RequestTaskAssignmentSchema).max(500).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be supplied",
  });

export type RequestTaskAssignmentInput = z.infer<
  typeof RequestTaskAssignmentSchema
>;
