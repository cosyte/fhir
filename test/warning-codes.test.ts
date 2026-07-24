import { describe, expect, it } from "vitest";

import {
  FATAL_CODES,
  ISSUE_CODES,
  decimalPrecisionAtRisk,
  parseResource,
  unknownProperty,
} from "../src/index.js";

/**
 * The public issue/fatal code registries are a stable contract, a rename is a breaking change
 * (roadmap Phase 2 snapshots the full set). This suite pins the Phase-1 codes so an accidental
 * rename fails loudly.
 */
describe("issue & fatal code registries (stable public contract)", () => {
  it("pins the issue codes (Phase 1 + the Phase-8 XML-reader code)", () => {
    expect(ISSUE_CODES).toEqual({
      DECIMAL_PRECISION_AT_RISK: "DECIMAL_PRECISION_AT_RISK",
      UNKNOWN_PROPERTY: "UNKNOWN_PROPERTY",
      UNEXPECTED_XML_CONTENT: "UNEXPECTED_XML_CONTENT",
    });
  });

  it("pins the fatal codes (Phase 1 + the Phase-11 depth-bound DoS guard)", () => {
    expect(FATAL_CODES).toEqual({
      MALFORMED_JSON: "MALFORMED_JSON",
      PRIMITIVE_EXTENSION_MISALIGNED: "PRIMITIVE_EXTENSION_MISALIGNED",
      MAX_DEPTH_EXCEEDED: "MAX_DEPTH_EXCEEDED",
    });
  });

  it("factory functions build value-free issues at the given expression", () => {
    expect(decimalPrecisionAtRisk("Observation.value")).toEqual({
      code: "DECIMAL_PRECISION_AT_RISK",
      severity: "information",
      expression: "Observation.value",
    });
    expect(unknownProperty("Patient.wibble")).toEqual({
      code: "UNKNOWN_PROPERTY",
      severity: "warning",
      expression: "Patient.wibble",
    });
  });

  it("DECIMAL_PRECISION_AT_RISK is information severity; UNKNOWN_PROPERTY is warning", () => {
    const { issues } = parseResource(
      '{"resourceType":"Observation","v":0.010,"a":1,"_a":{"nope":1}}',
    );
    const precision = issues.find((i) => i.code === ISSUE_CODES.DECIMAL_PRECISION_AT_RISK);
    const unknown = issues.find((i) => i.code === ISSUE_CODES.UNKNOWN_PROPERTY);
    expect(precision?.severity).toBe("information");
    expect(unknown?.severity).toBe("warning");
  });
});
