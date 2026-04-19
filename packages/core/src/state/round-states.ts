/**
 * Round state transitions — pure functions.
 */

import type { Result } from "../brand.js";
import { err, ok } from "../brand.js";
import type { RoundState } from "../model/enums.js";

export type RoundEvent =
  | { readonly kind: "start_round" }
  | { readonly kind: "complete_round" };

export type RoundTransitionError = {
  readonly from: RoundState;
  readonly event: RoundEvent["kind"];
  readonly message: string;
};

export function transitionRound(
  state: RoundState,
  event: RoundEvent,
): Result<RoundState, RoundTransitionError> {
  switch (state) {
    case "pending":
      if (event.kind === "start_round") return ok("in_progress");
      return roundErr(state, event.kind);

    case "in_progress":
      if (event.kind === "complete_round") return ok("complete");
      return roundErr(state, event.kind);

    case "complete":
      return err({ from: state, event: event.kind, message: "Round already complete" });
  }

  const _exhaustive: never = state;
  return _exhaustive;
}

function roundErr(from: RoundState, event: RoundEvent["kind"]): Result<never, RoundTransitionError> {
  return err({ from, event, message: `Invalid: "${event}" from "${from}"` });
}
