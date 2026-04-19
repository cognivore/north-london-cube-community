import type {
  NonEmptyString,
  Pence,
  PositiveInt,
  VenueId,
} from "../ids.js";

export type Venue = {
  readonly id: VenueId;
  readonly name: NonEmptyString;
  readonly address: string;
  readonly capacity: PositiveInt;
  readonly maxPods: PositiveInt;
  readonly houseCreditPerPlayer: Pence;
  readonly active: boolean;
};
