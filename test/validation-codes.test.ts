import { describe, expect, it } from "vitest";

import {
  diagnosticFor,
  ISSUE_SEVERITIES,
  ISSUE_TYPES,
  VALIDATION_CODES,
  validationIssue,
  type ValidationCode,
} from "../src/index.js";

/**
 * The Phase-2 validation vocabulary is a stable public contract — a rename is a breaking change
 * (the roadmap snapshots the issue-code set here). These pin the exact registries so an accidental
 * rename fails loudly, and confirm every code has a value-free diagnostic and a correct IssueType.
 */
describe("validation code / severity / issue-type registries (stable public contract)", () => {
  it("pins the R4 issue-severity set (no R5 'success')", () => {
    expect(ISSUE_SEVERITIES).toEqual({
      FATAL: "fatal",
      ERROR: "error",
      WARNING: "warning",
      INFORMATION: "information",
    });
  });

  it("pins the IssueType subset (Phase 2 + Phase 3 safety additions)", () => {
    expect(ISSUE_TYPES).toEqual({
      STRUCTURE: "structure",
      REQUIRED: "required",
      VALUE: "value",
      CODE_INVALID: "code-invalid",
      INVARIANT: "invariant",
      NOT_SUPPORTED: "not-supported",
      INFORMATIONAL: "informational",
    });
  });

  it("pins the validation codes (Phase 2 + Phase 3 safety + Phase 4 quantity additions)", () => {
    expect(VALIDATION_CODES).toEqual({
      UNKNOWN_ELEMENT: "UNKNOWN_ELEMENT",
      RESOURCE_TYPE_UNKNOWN: "RESOURCE_TYPE_UNKNOWN",
      RESOURCE_NOT_MODELED: "RESOURCE_NOT_MODELED",
      TYPE_MISMATCH: "TYPE_MISMATCH",
      CHOICE_AMBIGUOUS: "CHOICE_AMBIGUOUS",
      CARDINALITY_MIN: "CARDINALITY_MIN",
      CARDINALITY_MAX: "CARDINALITY_MAX",
      PRIMITIVE_INVALID: "PRIMITIVE_INVALID",
      CODE_INVALID: "CODE_INVALID",
      UNHANDLED_MODIFIER_EXTENSION: "UNHANDLED_MODIFIER_EXTENSION",
      RETRACTED_RESOURCE: "RETRACTED_RESOURCE",
      INVARIANT_VIOLATED: "INVARIANT_VIOLATED",
      UCUM_UNIT_UNRECOGNIZED: "UCUM_UNIT_UNRECOGNIZED",
      VITAL_SIGN_UNIT_NONCONFORMANT: "VITAL_SIGN_UNIT_NONCONFORMANT",
      VALUE_TYPE_UNEXPECTED: "VALUE_TYPE_UNEXPECTED",
    });
  });

  it("gives every code a non-empty value-free diagnostic", () => {
    for (const code of Object.values(VALIDATION_CODES) as ValidationCode[]) {
      expect(diagnosticFor(code)).toMatch(/\S/);
    }
  });

  it("maps codes to the correct R4 IssueType", () => {
    expect(validationIssue("CARDINALITY_MIN", "error", "X.y").type).toBe("required");
    expect(validationIssue("UNKNOWN_ELEMENT", "warning", "X.y").type).toBe("structure");
    expect(validationIssue("CARDINALITY_MAX", "error", "X.y").type).toBe("structure");
    expect(validationIssue("PRIMITIVE_INVALID", "error", "X.y").type).toBe("value");
    expect(validationIssue("CODE_INVALID", "error", "X.y").type).toBe("code-invalid");
    expect(validationIssue("RESOURCE_NOT_MODELED", "information", "X").type).toBe("informational");
    expect(validationIssue("UNHANDLED_MODIFIER_EXTENSION", "error", "X").type).toBe(
      "not-supported",
    );
    expect(validationIssue("RETRACTED_RESOURCE", "information", "X").type).toBe("informational");
    expect(validationIssue("INVARIANT_VIOLATED", "error", "X", "ait-1").type).toBe("invariant");
    expect(validationIssue("UCUM_UNIT_UNRECOGNIZED", "warning", "X").type).toBe("value");
    expect(validationIssue("VITAL_SIGN_UNIT_NONCONFORMANT", "error", "X").type).toBe(
      "code-invalid",
    );
    expect(validationIssue("VALUE_TYPE_UNEXPECTED", "warning", "X").type).toBe("value");
  });

  it("carries the constraint key only on an invariant finding, never elsewhere", () => {
    expect(validationIssue("INVARIANT_VIOLATED", "error", "X", "obs-6").constraint).toBe("obs-6");
    expect(validationIssue("CODE_INVALID", "error", "X.y").constraint).toBeUndefined();
  });
});
