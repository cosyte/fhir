import { describe, expect, it } from "vitest";

import {
  diagnosticFor,
  serializeResource,
  toOperationOutcome,
  validationIssue,
  VALIDATION_CODES,
  type ValidationCode,
} from "../src/index.js";

describe("toOperationOutcome — the value-free wire form", () => {
  it("emits a spec-shaped OperationOutcome with severity / code / diagnostics / expression", () => {
    const issues = [validationIssue("CODE_INVALID", "error", "Patient.gender")];
    const json = serializeResource(toOperationOutcome(issues));
    expect(json).toContain('"resourceType":"OperationOutcome"');
    expect(json).toContain('"severity":"error"');
    expect(json).toContain('"code":"code-invalid"');
    expect(json).toContain('"expression":["Patient.gender"]');
    expect(json).toContain(diagnosticFor("CODE_INVALID"));
  });

  it("emits a single information/informational 'all clear' issue for no findings", () => {
    const json = serializeResource(toOperationOutcome([]));
    expect(json).toContain('"resourceType":"OperationOutcome"');
    expect(json).toContain('"severity":"information"');
    expect(json).toContain('"code":"informational"');
    // An OperationOutcome.issue is 1..* — never an empty array.
    expect(json).not.toContain('"issue":[]');
  });

  it("diagnostics carry no value — a location plus a coded reason only", () => {
    // Build one issue for every code and prove the serialized outcome contains no interpolated data.
    const allCodes = Object.values(VALIDATION_CODES) as ValidationCode[];
    const issues = allCodes.map((code) =>
      validationIssue(code, "error", "Patient.name[0].given[0]"),
    );
    const json = serializeResource(toOperationOutcome(issues));
    for (const code of allCodes) {
      expect(diagnosticFor(code).length).toBeGreaterThan(0);
      expect(json).toContain(diagnosticFor(code));
    }
    // The expression is the only variable part, and it is a FHIRPath location, not a value.
    expect(json).toContain('"expression":["Patient.name[0].given[0]"]');
  });
});
