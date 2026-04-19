import type { NonEmptyArray } from "../brand.js";
import type {
  CubeId,
  EvenPodSize,
  ISO8601,
  NonEmptyString,
  PositiveInt,
  Url,
  UserId,
} from "../ids.js";
import type { DraftFormat } from "./enums.js";

export type Cube = {
  readonly id: CubeId;
  readonly ownerId: UserId;
  readonly name: NonEmptyString;
  readonly cubecobraUrl: Url;
  readonly cubecobraId: string;
  readonly cardCount: PositiveInt;
  readonly supportedFormats: NonEmptyArray<DraftFormat>;
  readonly preferredPodSize: EvenPodSize;
  readonly minPodSize: EvenPodSize;
  readonly maxPodSize: EvenPodSize;
  readonly tags: ReadonlyArray<string>;
  readonly lastRunAt: ISO8601 | null;
  readonly retired: boolean;
};
