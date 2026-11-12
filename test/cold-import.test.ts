import { afterEach, describe, expect, it, vi } from "vitest";

import type * as Fhir from "../src/index.js";
import type * as Parser from "../src/fhirpath/parser.js";

/**
 * What importing the package does before a caller asks it for anything. A cold import of the built
 * package is held to a time budget on a CI runner (`pnpm check:cold-import`); these cases hold the
 * change that brought it there, which a reading alone could lose without saying why:
 *
 * - no FHIRPath expression is parsed at import: the base constraints' expressions are parsed on the
 *   first validation, once, and kept;
 * - a parse that fails for a reason other than the grammar keeps nothing, reports the constraint
 *   unchecked for that call, and the next call parses again;
 * - the first validation may happen anywhere, inside a stream's loop included, and answers as a
 *   warm one does;
 * - the first read and validation, which make the JSON reader's and the safety walk's tables on
 *   first use rather than at import, answer as later ones do (`test/import-work.test.ts` holds
 *   what the modules build at import).
 *
 * Every case imports a fresh copy of `src/index.ts`, so nothing an earlier case loaded counts. Every
 * document is synthetic.
 */

afterEach(() => {
  vi.doUnmock("../src/fhirpath/parser.js");
  vi.resetModules();
});

/** A fresh import of the package source. */
async function importFresh(): Promise<typeof Fhir> {
  vi.resetModules();
  return import("../src/index.js");
}

/**
 * Count the package's own FHIRPath parses. `fail` is asked before each one and, when it answers
 * `true`, the parse throws a `RangeError`, as one does when the stack runs out.
 */
function countParses(fail: () => boolean = () => false): { readonly calls: string[] } {
  const seen = { calls: [] as string[] };
  vi.doMock("../src/fhirpath/parser.js", async (original) => {
    const real = await original<typeof Parser>();
    return {
      ...real,
      parseFhirPath: (expression: string) => {
        seen.calls.push(expression);
        if (fail()) throw new RangeError("Maximum call stack size exceeded");
        return real.parseFhirPath(expression);
      },
    };
  });
  return seen;
}

/**
 * A synthetic Patient whose `contact` carries none of `name`, `telecom`, `address` or
 * `organization`, so `pat-1` does not hold, with one `contained` entry, so `dom-3` is unchecked.
 */
const PATIENT = JSON.stringify({
  resourceType: "Patient",
  id: "fake-patient-1",
  contained: [{ resourceType: "Organization", id: "fake-org-1", name: "Example Clinic" }],
  contact: [{ gender: "female" }],
});

/** The base-constraint findings of one validation, as `code key path` lines. */
function baseFindings(fhir: typeof Fhir, json: string): string[] {
  const { resource } = fhir.parseResource(json);
  return fhir
    .validateResource(resource)
    .issues.filter((i) => i.code === "INVARIANT_VIOLATED" || i.code === "INVARIANT_UNCHECKED")
    .map((i) => `${i.code} ${i.constraint ?? ""} ${i.expression}`);
}

describe("importing the package", () => {
  it("parses no FHIRPath expression", async () => {
    const seen = countParses();
    await importFresh();
    expect(seen.calls).toEqual([]);
  });

  it("parses the base constraints on the first validation, and only then", async () => {
    const seen = countParses();
    const fhir = await importFresh();
    expect(seen.calls).toEqual([]);
    const first = baseFindings(fhir, PATIENT);
    const parsedOnce = seen.calls.length;
    // The eleven rows of the table and the `contained` selection dom-3 starts from.
    expect(parsedOnce).toBe(12);
    expect(new Set(seen.calls).size).toBe(parsedOnce);

    const second = baseFindings(fhir, PATIENT);
    expect(seen.calls.length).toBe(parsedOnce);
    expect(second).toEqual(first);
    expect(first).toContain("INVARIANT_VIOLATED pat-1 Patient.contact[0]");
    expect(first).toContain("INVARIANT_UNCHECKED dom-3 Patient");
  });
});

describe("a first validation whose parses fail", () => {
  it("reports the constraints unchecked, keeps nothing, and parses again on the next call", async () => {
    let failing = true;
    const seen = countParses(() => failing);
    const fhir = await importFresh();

    const failed = baseFindings(fhir, PATIENT);
    // Never satisfied, never violated on a parse that did not happen: unchecked.
    expect(failed.some((line) => line.startsWith("INVARIANT_VIOLATED"))).toBe(false);
    expect(failed).toContain("INVARIANT_UNCHECKED pat-1 Patient.contact[0]");
    expect(failed).toContain("INVARIANT_UNCHECKED dom-2 Patient");
    expect(failed).toContain("INVARIANT_UNCHECKED dom-3 Patient");
    const afterFailure = seen.calls.length;

    failing = false;
    const recovered = baseFindings(fhir, PATIENT);
    expect(seen.calls.length).toBeGreaterThan(afterFailure);
    expect(recovered).toContain("INVARIANT_VIOLATED pat-1 Patient.contact[0]");

    const warm = await (async () => {
      vi.doUnmock("../src/fhirpath/parser.js");
      return baseFindings(await importFresh(), PATIENT);
    })();
    expect(recovered).toEqual(warm);

    // Kept after the build that succeeded: a third call parses nothing.
    const kept = seen.calls.length;
    baseFindings(fhir, PATIENT);
    expect(seen.calls.length).toBe(kept);
  });
});

describe("a first validation inside a stream", () => {
  it("answers as a validation after a warm start does", async () => {
    const fhir = await importFresh();
    const lines = [PATIENT, PATIENT].join("\n");
    const inside: string[][] = [];
    for await (const record of fhir.streamNdjson([lines])) {
      if (record.resource === undefined) throw new Error("the synthetic line did not parse");
      const { issues } = fhir.validateResource(record.resource);
      inside.push(issues.map((i) => `${i.code} ${i.constraint ?? ""} ${i.expression}`));
    }
    const { resource } = fhir.parseResource(PATIENT);
    const warm = fhir
      .validateResource(resource)
      .issues.map((i) => `${i.code} ${i.constraint ?? ""} ${i.expression}`);
    expect(inside).toEqual([warm, warm]);
  });
});

/**
 * A synthetic Bundle whose entry is a plain Observation, so a read takes the tape path and its
 * plain-object check, and a validation asks the common resource types and the types with a
 * resource position below their top level: each a table made on first use rather than at import.
 */
const BUNDLE = JSON.stringify({
  resourceType: "Bundle",
  type: "collection",
  entry: [
    {
      resource: {
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://example.org/fake-codes", code: "fake-1" }] },
        valueString: "example",
      },
    },
  ],
});

/** Everything a read and a validation of `json` answer, as one comparable value. */
function readAndValidate(fhir: typeof Fhir, json: string): unknown {
  const { resource, issues } = fhir.parseResource(json);
  const validation = fhir.validateResource(resource);
  return {
    model: fhir.serializeResource(resource),
    read: issues.map((i) => `${i.code} ${i.expression}`),
    validation: validation.issues.map((i) => `${i.code} ${i.expression}`),
    safety: fhir.readSafety(resource),
  };
}

describe("the first read and validation after import", () => {
  it("answer as later ones do, the tables made on first use included", async () => {
    const fhir = await importFresh();
    const first = readAndValidate(fhir, BUNDLE);
    const second = readAndValidate(fhir, BUNDLE);
    expect(first).toEqual(second);
    const warm = readAndValidate(await importFresh(), BUNDLE);
    expect(readAndValidate(fhir, BUNDLE)).toEqual(warm);
  });
});
