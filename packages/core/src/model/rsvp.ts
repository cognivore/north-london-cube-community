import type {
  FridayId,
  ISO8601,
  RsvpId,
  UserId,
} from "../ids.js";
import type { RsvpState } from "./enums.js";

export type Rsvp = {
  readonly id: RsvpId;
  readonly fridayId: FridayId;
  readonly userId: UserId;
  readonly state: RsvpState;
  readonly createdAt: ISO8601;
  readonly lastTransitionAt: ISO8601;
};
