import type {
  AuditEventId,
  ISO8601,
  UserId,
} from "../ids.js";

// ---------------------------------------------------------------------------
// AuditSubject
// ---------------------------------------------------------------------------

export type AuditSubjectKind =
  | "friday"
  | "pod"
  | "user"
  | "cube"
  | "enrollment"
  | "rsvp"
  | "vote"
  | "round"
  | "match";

export type AuditSubject = {
  readonly kind: AuditSubjectKind;
  readonly id: string;
};

// ---------------------------------------------------------------------------
// AuditEvent
// ---------------------------------------------------------------------------

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

export type AuditEvent = {
  readonly id: AuditEventId;
  readonly at: ISO8601;
  readonly actorId: UserId | "system";
  readonly subject: AuditSubject;
  readonly action: string;
  readonly before: JsonValue | null;
  readonly after: JsonValue | null;
};

export type AuditEventInput = Omit<AuditEvent, "id" | "at">;
