/**
 * Zod schemas for API request/response shapes.
 */

import { z } from "zod";
import {
  EmailSchema,
  NonEmptyStringSchema,
  UrlSchema,
  EvenPodSizeSchema,
  EnrollmentIdSchema,
  CubeIdSchema,
  NonNegativeIntSchema,
  ISO8601Schema,
} from "./primitives.js";
import { DraftFormatSchema } from "./entities.js";

// ---------------------------------------------------------------------------
// RegisterInput
// ---------------------------------------------------------------------------

export const RegisterInputSchema = z.object({
  email: EmailSchema,
  displayName: NonEmptyStringSchema,
  inviteCode: z.string(),
});

export type RegisterInput = z.infer<typeof RegisterInputSchema>;

// ---------------------------------------------------------------------------
// LoginInput
// ---------------------------------------------------------------------------

export const LoginInputSchema = z.object({
  email: EmailSchema,
});

export type LoginInput = z.infer<typeof LoginInputSchema>;

// ---------------------------------------------------------------------------
// RsvpInput
// ---------------------------------------------------------------------------

export const RsvpInputSchema = z.object({
  action: z.enum(["in", "out"]),
});

export type RsvpInput = z.infer<typeof RsvpInputSchema>;

// ---------------------------------------------------------------------------
// EnrollCubeInput
// ---------------------------------------------------------------------------

export const EnrollCubeInputSchema = z.object({
  cubeId: CubeIdSchema,
});

export type EnrollCubeInput = z.infer<typeof EnrollCubeInputSchema>;

// ---------------------------------------------------------------------------
// VoteInput
// ---------------------------------------------------------------------------

export const VoteInputSchema = z.object({
  ranking: z.array(EnrollmentIdSchema).min(1),
});

export type VoteInput = z.infer<typeof VoteInputSchema>;

// ---------------------------------------------------------------------------
// CreateCubeInput
// ---------------------------------------------------------------------------

export const CreateCubeInputSchema = z.object({
  cubecobraUrl: UrlSchema,
  name: NonEmptyStringSchema,
  supportedFormats: z.array(DraftFormatSchema).min(1),
  preferredPodSize: EvenPodSizeSchema,
  minPodSize: EvenPodSizeSchema,
  maxPodSize: EvenPodSizeSchema,
});

export type CreateCubeInput = z.infer<typeof CreateCubeInputSchema>;

// ---------------------------------------------------------------------------
// UpdateCubeInput (partial of CreateCubeInput)
// ---------------------------------------------------------------------------

export const UpdateCubeInputSchema = CreateCubeInputSchema.partial();

export type UpdateCubeInput = z.infer<typeof UpdateCubeInputSchema>;

// ---------------------------------------------------------------------------
// ReportMatchInput
// ---------------------------------------------------------------------------

export const ReportMatchInputSchema = z.object({
  p1Wins: NonNegativeIntSchema,
  p2Wins: NonNegativeIntSchema,
  draws: NonNegativeIntSchema,
});

export type ReportMatchInput = z.infer<typeof ReportMatchInputSchema>;

// ---------------------------------------------------------------------------
// UpdateProfileInput
// ---------------------------------------------------------------------------

export const UpdateProfileInputSchema = z.object({
  displayName: NonEmptyStringSchema.optional(),
  preferredFormats: z.array(DraftFormatSchema).min(1).optional(),
  fallbackFormats: z.array(DraftFormatSchema).optional(),
  hostCapable: z.boolean().optional(),
  bio: z.string().optional(),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;

// ---------------------------------------------------------------------------
// ForceStateInput (admin forcing a Friday state transition)
// ---------------------------------------------------------------------------

export const ForceStateInputSchema = z.object({
  targetState: z.string(),
  reason: z.string().optional(),
});

export type ForceStateInput = z.infer<typeof ForceStateInputSchema>;

// ---------------------------------------------------------------------------
// BanUserInput
// ---------------------------------------------------------------------------

export const BanUserInputSchema = z.object({
  until: ISO8601Schema,
  reason: z.string(),
});

export type BanUserInput = z.infer<typeof BanUserInputSchema>;

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
