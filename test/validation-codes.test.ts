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

  it("pins the IssueType subset (Phase 2 + Phase 3 safety + Phase 9 bundle additions)", () => {
    expect(ISSUE_TYPES).toEqual({
      STRUCTURE: "structure",
      REQUIRED: "required",
      VALUE: "value",
      CODE_INVALID: "code-invalid",
      INVARIANT: "invariant",
      NOT_SUPPORTED: "not-supported",
      INFORMATIONAL: "informational",
      BUSINESS_RULE: "business-rule",
      NOT_FOUND: "not-found",
    });
  });

  it("pins the validation codes (Phase 2 + Phase 3 safety + Phase 4 quantity + Phase 5 terminology + Phase 6 profile + Phase 7 invariant)", () => {
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
      INVARIANT_UNCHECKED: "INVARIANT_UNCHECKED",
      UCUM_UNIT_UNRECOGNIZED: "UCUM_UNIT_UNRECOGNIZED",
      VITAL_SIGN_UNIT_NONCONFORMANT: "VITAL_SIGN_UNIT_NONCONFORMANT",
      VALUE_TYPE_UNEXPECTED: "VALUE_TYPE_UNEXPECTED",
      CODE_SYSTEM_UNKNOWN: "CODE_SYSTEM_UNKNOWN",
      CODE_SYSTEM_UNEXPECTED: "CODE_SYSTEM_UNEXPECTED",
      CODE_NOT_IN_VALUESET: "CODE_NOT_IN_VALUESET",
      PROFILE_SLICE_UNMATCHED: "PROFILE_SLICE_UNMATCHED",
      PROFILE_SLICE_UNCHECKED: "PROFILE_SLICE_UNCHECKED",
      MUST_SUPPORT_ABSENT: "MUST_SUPPORT_ABSENT",
      PROFILE_VERSION_MISMATCH: "PROFILE_VERSION_MISMATCH",
      PROFILE_FIXED_MISMATCH: "PROFILE_FIXED_MISMATCH",
      PROFILE_PATTERN_MISMATCH: "PROFILE_PATTERN_MISMATCH",
      REFERENCE_UNRESOLVED: "REFERENCE_UNRESOLVED",
      CONTAINED_CYCLE: "CONTAINED_CYCLE",
      FULLURL_ID_MISMATCH: "FULLURL_ID_MISMATCH",
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
    expect(validationIssue("INVARIANT_UNCHECKED", "information", "X", "us-core-1").type).toBe(
      "informational",
    );
    expect(validationIssue("UCUM_UNIT_UNRECOGNIZED", "warning", "X").type).toBe("value");
    expect(validationIssue("VITAL_SIGN_UNIT_NONCONFORMANT", "error", "X").type).toBe(
      "code-invalid",
    );
    expect(validationIssue("VALUE_TYPE_UNEXPECTED", "warning", "X").type).toBe("value");
    expect(validationIssue("CODE_SYSTEM_UNKNOWN", "information", "X").type).toBe("code-invalid");
    expect(validationIssue("CODE_SYSTEM_UNEXPECTED", "warning", "X").type).toBe("code-invalid");
    expect(validationIssue("CODE_NOT_IN_VALUESET", "error", "X").type).toBe("code-invalid");
    expect(validationIssue("PROFILE_SLICE_UNMATCHED", "error", "X").type).toBe("structure");
    expect(validationIssue("PROFILE_SLICE_UNCHECKED", "information", "X").type).toBe(
      "informational",
    );
    expect(validationIssue("MUST_SUPPORT_ABSENT", "information", "X").type).toBe("informational");
    expect(validationIssue("PROFILE_VERSION_MISMATCH", "warning", "X").type).toBe("business-rule");
    expect(validationIssue("PROFILE_FIXED_MISMATCH", "error", "X").type).toBe("value");
    expect(validationIssue("PROFILE_PATTERN_MISMATCH", "error", "X").type).toBe("value");
    expect(validationIssue("REFERENCE_UNRESOLVED", "warning", "X").type).toBe("not-found");
    expect(validationIssue("CONTAINED_CYCLE", "error", "X").type).toBe("structure");
    expect(validationIssue("FULLURL_ID_MISMATCH", "error", "X").type).toBe("business-rule");
  });

  it("carries the constraint key only on an invariant finding, never elsewhere", () => {
    expect(validationIssue("INVARIANT_VIOLATED", "error", "X", "obs-6").constraint).toBe("obs-6");
    expect(validationIssue("CODE_INVALID", "error", "X.y").constraint).toBeUndefined();
  });
});
