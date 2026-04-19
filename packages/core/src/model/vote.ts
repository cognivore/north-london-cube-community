import type { NonEmptyArray } from "../brand.js";
import type {
  EnrollmentId,
  FridayId,
  ISO8601,
  UserId,
  VoteId,
} from "../ids.js";

export type Vote = {
  readonly id: VoteId;
  readonly fridayId: FridayId;
  readonly userId: UserId;
  readonly ranking: NonEmptyArray<EnrollmentId>;
  readonly createdAt: ISO8601;
};
