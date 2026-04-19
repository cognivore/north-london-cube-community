import type {
  ISO8601,
  SessionId,
  UserId,
} from "../ids.js";

export type Session = {
  readonly id: SessionId;
  readonly userId: UserId;
  readonly createdAt: ISO8601;
  readonly expiresAt: ISO8601;
  readonly lastActivityAt: ISO8601;
};

export type InviteCode = {
  readonly code: string;
  readonly createdBy: UserId;
  readonly createdAt: ISO8601;
  readonly expiresAt: ISO8601 | null;
  readonly maxUses: number | null;
  readonly usedCount: number;
};
