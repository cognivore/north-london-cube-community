/**
 * RNG capability — abstracts randomness for testability.
 */

import { Context, Effect, Layer } from "effect";

export interface RNGService {
  readonly uuid: () => Effect.Effect<string>;
  readonly shuffle: <A>(xs: ReadonlyArray<A>) => Effect.Effect<Array<A>>;
  readonly randomInt: (min: number, max: number) => Effect.Effect<number>;
}

export class RNG extends Context.Tag("RNG")<RNG, RNGService>() {}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const RNGLive = Layer.succeed(RNG, {
  uuid: () =>
    Effect.sync(() => crypto.randomUUID()),

  shuffle: <A>(xs: ReadonlyArray<A>) =>
    Effect.sync(() => {
      const arr = [...xs];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j]!, arr[i]!];
      }
      return arr;
    }),

  randomInt: (min: number, max: number) =>
    Effect.sync(() => Math.floor(Math.random() * (max - min + 1)) + min),
});

// ---------------------------------------------------------------------------
// Test implementation — seeded, deterministic
// ---------------------------------------------------------------------------

export const makeTestRNG = (seed: number = 42) => {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) & 0xffffffff;
    return (state >>> 0) / 0xffffffff;
  };

  let uuidCounter = 0;

  return Layer.succeed(RNG, {
    uuid: () =>
      Effect.sync(() => {
        uuidCounter++;
        const hex = uuidCounter.toString(16).padStart(12, "0");
        return `00000000-0000-4000-8000-${hex}`;
      }),

    shuffle: <A>(xs: ReadonlyArray<A>) =>
      Effect.sync(() => {
        const arr = [...xs];
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          [arr[i], arr[j]] = [arr[j]!, arr[i]!];
        }
        return arr;
      }),

    randomInt: (min: number, max: number) =>
      Effect.sync(() => Math.floor(next() * (max - min + 1)) + min),
  });
};
