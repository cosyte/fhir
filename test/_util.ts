import { expect } from "vitest";

/**
 * Assert a value is present and return it narrowed, a lint-clean stand-in for the non-null
 * assertion operator (`!`), which the shared ESLint config forbids. Use for array/`Map` reads under
 * `noUncheckedIndexedAccess` where the test logically knows the element exists.
 */
export function req<T>(value: T | undefined | null, label = "value"): T {
  expect(value, `${label} should be defined`).not.toBeUndefined();
  if (value === undefined || value === null) throw new Error(`${label} is nullish`);
  return value;
}

/** `req(arr[i])` with a helpful label. */
export function nth<T>(arr: readonly T[], i: number): T {
  return req(arr[i], `index ${String(i)}`);
}
