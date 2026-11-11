import { expect } from "vitest";

import type { SafetyReadout } from "../src/index.js";

/**
 * Assert a readout affirms its document on every channel but the type assessment.
 *
 * Many tests pin "this channel stays empty" through `safeToSummarize: true` over a document of a type
 * the safety layer does not model (`Procedure`, `ServiceRequest`, a contained `Organization`). Such a
 * root is now listed on `notAssessed` and the readout is never `safeToSummarize`, so those tests
 * assert this instead: when nothing is on `notAssessed`, `safeToSummarize` is `true` exactly as
 * before, and when something is, every other channel that withdraws the verdict is empty, which is
 * what the old `true` established about them.
 *
 * @param safety - The readout under test.
 * @param message - An optional label for the assertion, as `expect` takes one.
 */
export function expectSafeButForType(safety: SafetyReadout, message?: string): void {
  if (safety.notAssessed.length === 0) {
    expect(safety.safeToSummarize, message).toBe(true);
    return;
  }
  expect(safety.safeToSummarize, message).toBe(false);
  expect(
    {
      unhandledModifierExtensions: safety.unhandledModifierExtensions,
      modifierElements: safety.modifierElements,
      shadowedProperties: safety.shadowedProperties,
      arrayWrappedScalars: safety.arrayWrappedScalars,
      nestedArrays: safety.nestedArrays,
      droppedText: safety.droppedText,
      unreadableBooleans: safety.unreadableBooleans,
      nearMissNegationCodes: safety.nearMissNegationCodes,
      unreadableNegationCodes: safety.unreadableNegationCodes,
      unreadableIntents: safety.unreadableIntents,
      unreadableDatatypeUses: safety.unreadableDatatypeUses,
      unreadableAbsenceMarkers: safety.unreadableAbsenceMarkers,
      conflictingAbsenceMarkers: safety.conflictingAbsenceMarkers,
    },
    message,
  ).toEqual({
    unhandledModifierExtensions: [],
    modifierElements: [],
    shadowedProperties: [],
    arrayWrappedScalars: [],
    nestedArrays: [],
    droppedText: [],
    unreadableBooleans: [],
    nearMissNegationCodes: [],
    unreadableNegationCodes: [],
    unreadableIntents: [],
    unreadableDatatypeUses: [],
    unreadableAbsenceMarkers: [],
    conflictingAbsenceMarkers: [],
  });
}
