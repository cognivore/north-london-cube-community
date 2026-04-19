/**
 * Match report programs — players submit results.
 */

import { Effect } from "effect";
import type { MatchResult } from "@cubehall/core";
import {
  unsafeMatchId, unsafeUserId,
} from "@cubehall/core";
import { Clock } from "../capabilities/clock.js";
import { Logger } from "../capabilities/logger.js";
import { EventBus } from "../capabilities/event-bus.js";
import { Audit } from "../capabilities/audit.js";
import { MatchRepo, RoundRepo } from "../repos/types.js";
import type { RepoError } from "../repos/types.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type MatchReportError =
  | { readonly kind: "match_not_found" }
  | { readonly kind: "not_a_player" }
  | { readonly kind: "round_not_in_progress" }
  | { readonly kind: "already_reported" }
  | RepoError;

// ---------------------------------------------------------------------------
// Report match result
// ---------------------------------------------------------------------------

export const reportMatch = (input: {
  matchId: string;
  userId: string;
  p1Wins: number;
  p2Wins: number;
  draws: number;
}) =>
  Effect.gen(function* () {
    const clock = yield* Clock;
    const logger = yield* Logger;
    const eventBus = yield* EventBus;
    const audit = yield* Audit;
    const matchRepo = yield* MatchRepo;
    const roundRepo = yield* RoundRepo;

    const matchId = unsafeMatchId(input.matchId);
    const userId = unsafeUserId(input.userId);

    const match = yield* matchRepo.findById(matchId);
    if (!match) {
      return yield* Effect.fail<MatchReportError>({ kind: "match_not_found" });
    }

    // Verify player is in this match
    if (match.player1Id !== userId && match.player2Id !== userId) {
      return yield* Effect.fail<MatchReportError>({ kind: "not_a_player" });
    }

    // Verify round is in progress
    const round = yield* roundRepo.findById(match.roundId);
    if (!round || round.state !== "in_progress") {
      return yield* Effect.fail<MatchReportError>({ kind: "round_not_in_progress" });
    }

    // Verify not already reported
    if (match.result.kind !== "pending") {
      return yield* Effect.fail<MatchReportError>({ kind: "already_reported" });
    }

    const now = yield* clock.now();
    const result: MatchResult = {
      kind: "reported",
      p1Wins: input.p1Wins as 0 | 1 | 2,
      p2Wins: input.p2Wins as 0 | 1 | 2,
      draws: input.draws as 0 | 1 | 2 | 3,
    };

    yield* matchRepo.updateResult(matchId, result, userId, now);

    yield* logger.info("Match reported", {
      matchId: input.matchId,
      result: `${input.p1Wins}-${input.p2Wins}-${input.draws}`,
    });
    yield* audit.record({
      actorId: userId,
      subject: { kind: "match", id: matchId },
      action: "match.reported",
      before: { kind: "pending" },
      after: result as unknown as null,
    });
    yield* eventBus.publish({ kind: "match.reported", matchId, result });

    return result;
  });
