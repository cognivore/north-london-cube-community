/**
 * DomainEvent — the internal event bus vocabulary.
 * All events are values, published inside transactions via outbox pattern.
 */

import type {
  CubeId,
  FridayId,
  ISO8601,
  LocalDate,
  MatchId,
  PodId,
  RoundId,
  UserId,
  VenueId,
} from "./ids.js";
import type { MatchResult } from "./model/index.js";
import type { Standing } from "./engine/pairings-types.js";

export type DomainEvent =
  | { readonly kind: "friday.scheduled"; readonly fridayId: FridayId; readonly date: LocalDate; readonly venueId: VenueId }
  | { readonly kind: "friday.opened"; readonly fridayId: FridayId }
  | { readonly kind: "friday.locked"; readonly fridayId: FridayId }
  | { readonly kind: "friday.confirmed"; readonly fridayId: FridayId }
  | { readonly kind: "friday.cancelled"; readonly fridayId: FridayId; readonly reason: string }
  | { readonly kind: "friday.begun"; readonly fridayId: FridayId }
  | { readonly kind: "friday.completed"; readonly fridayId: FridayId }
  | { readonly kind: "cube.enrolled"; readonly fridayId: FridayId; readonly cubeId: CubeId; readonly hostId: UserId }
  | { readonly kind: "cube.withdrawn"; readonly fridayId: FridayId; readonly cubeId: CubeId }
  | { readonly kind: "rsvp.created"; readonly fridayId: FridayId; readonly userId: UserId }
  | { readonly kind: "rsvp.cancelled"; readonly fridayId: FridayId; readonly userId: UserId }
  | { readonly kind: "pod.created"; readonly podId: PodId; readonly fridayId: FridayId }
  | { readonly kind: "round.started"; readonly roundId: RoundId; readonly podId: PodId }
  | { readonly kind: "round.ended"; readonly roundId: RoundId; readonly podId: PodId }
  | { readonly kind: "match.reported"; readonly matchId: MatchId; readonly result: MatchResult }
  | { readonly kind: "pod.completed"; readonly podId: PodId; readonly standings: ReadonlyArray<Standing> }
  | { readonly kind: "user.banned"; readonly userId: UserId; readonly until: ISO8601; readonly reason: string };
