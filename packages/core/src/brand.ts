/**
 * Branded types and Result utilities.
 * No runtime dependencies — pure TypeScript.
 */

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

export declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type Result<T, E> = Ok<T> | Err<E>;
export type Ok<T> = { readonly _tag: "Ok"; readonly value: T };
export type Err<E> = { readonly _tag: "Err"; readonly error: E };

export const ok = <T>(value: T): Ok<T> => ({ _tag: "Ok", value });
export const err = <E>(error: E): Err<E> => ({ _tag: "Err", error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> =>
  result._tag === "Ok";

export const isErr = <T, E>(result: Result<T, E>): result is Err<E> =>
  result._tag === "Err";

export const mapResult = <T, U, E>(
  result: Result<T, E>,
  f: (value: T) => U,
): Result<U, E> => (isOk(result) ? ok(f(result.value)) : result);

export const flatMapResult = <T, U, E>(
  result: Result<T, E>,
  f: (value: T) => Result<U, E>,
): Result<U, E> => (isOk(result) ? f(result.value) : result);

export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  isOk(result) ? result.value : fallback;

// ---------------------------------------------------------------------------
// NonEmptyArray
// ---------------------------------------------------------------------------

export type NonEmptyArray<T> = [T, ...T[]];

export const isNonEmpty = <T>(xs: T[]): xs is NonEmptyArray<T> => xs.length > 0;

// ---------------------------------------------------------------------------
// Validation error
// ---------------------------------------------------------------------------

export type ValidationError = {
  readonly field: string;
  readonly message: string;
};
