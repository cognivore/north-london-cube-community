/**
 * Pod state transitions — pure functions.
 */

import type { Result } from "../brand.js";
import { err, ok } from "../brand.js";
import type { PodState } from "../model/enums.js";

export type PodEvent =
  | { readonly kind: "start_building" }
  | { readonly kind: "start_playing" }
  | { readonly kind: "complete_pod" }
  | { readonly kind: "cancel_pod" };

export type PodTransitionError = {
  readonly from: PodState;
  readonly event: PodEvent["kind"];
  readonly message: string;
};

export function transitionPod(
  state: PodState,
  event: PodEvent,
): Result<PodState, PodTransitionError> {
  if (event.kind === "cancel_pod") {
    if (state === "complete" || state === "cancelled") {
      return err({ from: state, event: event.kind, message: `Cannot cancel pod in state "${state}"` });
    }
    return ok("cancelled");
  }

  switch (state) {
    case "drafting":
      if (event.kind === "start_building") return ok("building");
      return podErr(state, event.kind);

    case "building":
      if (event.kind === "start_playing") return ok("playing");
      return podErr(state, event.kind);

    case "playing":
      if (event.kind === "complete_pod") return ok("complete");
      return podErr(state, event.kind);

    case "complete":
      return err({ from: state, event: event.kind, message: "Pod already complete" });

    case "cancelled":
      return err({ from: state, event: event.kind, message: "Pod already cancelled" });
  }

  const _exhaustive: never = state;
  return _exhaustive;
}

function podErr(from: PodState, event: PodEvent["kind"]): Result<never, PodTransitionError> {
  return err({ from, event, message: `Invalid: "${event}" from "${from}"` });
}
