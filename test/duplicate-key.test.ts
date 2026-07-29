import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  complex,
  FhirSafetyError,
  getAllProperties,
  getProperty,
  ISSUE_CODES,
  isRetracted,
  nodesEquivalent,
  parseResource,
  parseResourceXml,
  primitive,
  readSafety,
  serializeResource,
  shadowedProperties,
  validateResource,
  type FhirIssue,
} from "../src/index.js";

/**
 * A repeated JSON property name.
 *
 * FHIR JSON requires unique property names (json.html §2.6.2: "Property names SHALL be unique") and
 * expresses a repeating element as an array, so a name written twice is a defect. RFC 8259 §4 leaves
 * the winner undefined ("the behavior of software that receives such an object is unpredictable"),
 * which means neither member is authoritative and no reader can rank them without inventing a rule.
 *
 * The hazard this pins down is not the ranking, it is the silence: a document whose `status` is
 * written twice with `entered-in-error` in the member the reader did not keep used to read back as a
 * live, summarizable observation, with an empty issue list and a clean safety verdict. The values are
 * synthetic throughout.
 */

/** The reported document: a retraction written in the second of two `status` members. */
const RETRACTION_LAST =
  '{"resourceType":"Observation","status":"final","code":{"text":"synthetic panel"},' +
  '"status":"entered-in-error"}';

/** The same defect mirrored: the retraction is in the *first* member instead. */
const RETRACTION_FIRST =
  '{"resourceType":"Observation","status":"entered-in-error","code":{"text":"synthetic panel"},' +
  '"status":"final"}';

function codes(issues: readonly FhirIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

describe("a repeated property name is read, flagged, and never silently resolved", () => {
  it("keeps the shadowed member instead of discarding it", () => {
    const { resource } = parseResource(RETRACTION_LAST);
    expect(
      getAllProperties(resource, "status").map((n) => (n.kind === "primitive" ? n.value : n)),
    ).toEqual(["final", "entered-in-error"]);
  });

  it("raises DUPLICATE_PROPERTY at the element's location", () => {
    const { issues } = parseResource(RETRACTION_LAST);
    expect(issues).toContainEqual({
      code: ISSUE_CODES.DUPLICATE_PROPERTY,
      severity: "warning",
      expression: "Observation.status",
    });
  });

  it("leaves a conformant document untouched: no issue, no duplicates key", () => {
    const { resource, issues } = parseResource(
      '{"resourceType":"Observation","status":"final","code":{"text":"synthetic panel"}}',
    );
    expect(codes(issues)).not.toContain(ISSUE_CODES.DUPLICATE_PROPERTY);
    expect(resource.duplicates).toBeUndefined();
    expect(shadowedProperties(resource, "Observation")).toEqual([]);
    // A node built without duplicates is structurally identical to one built with an empty list, so
    // the field cannot perturb equality on a conformant document.
    expect(complex([{ name: "status", value: primitive("final") }], [])).toEqual(
      complex([{ name: "status", value: primitive("final") }]),
    );
  });

  it("still returns the first member from the single-value lookup (the wins rule is unchanged)", () => {
    const { resource } = parseResource(RETRACTION_LAST);
    const status = getProperty(resource, "status");
    expect(status?.kind === "primitive" ? status.value : undefined).toBe("final");
  });
});

describe("the safety readout no longer affirms over a value it did not rank", () => {
  it("reports the retraction when it is in the shadowed member (the reported defect)", () => {
    const { resource } = parseResource(RETRACTION_LAST);
    const safety = readSafety(resource);
    expect(safety.retracted).toBe(true);
    expect(safety.negations).toContain("entered-in-error");
    expect(safety.safeToSummarize).toBe(false);
    expect(safety.shadowedProperties).toEqual(["Observation.status"]);
  });

  it("reports it the same way when the retraction is in the surviving member", () => {
    const { resource } = parseResource(RETRACTION_FIRST);
    const safety = readSafety(resource);
    // Symmetry is the point: the fix is not a flip to last-wins, which would only move the blind spot.
    expect(safety.retracted).toBe(true);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("refuses to summarize a duplicate on any element, not only a safety-bearing one", () => {
    const { resource } = parseResource(
      '{"resourceType":"Patient","gender":"male","gender":"female"}',
    );
    const safety = readSafety(resource);
    expect(safety.safeToSummarize).toBe(false);
    expect(safety.shadowedProperties).toEqual(["Patient.gender"]);
    expect(safety.unhandledModifierExtensions).toEqual([]);
  });

  it("assertSafeToSummarize throws, carrying the location and no value", () => {
    const { resource } = parseResource(RETRACTION_LAST);
    expect(() => {
      assertSafeToSummarize(resource);
    }).toThrow(FhirSafetyError);
    try {
      assertSafeToSummarize(resource);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FhirSafetyError);
      const safetyError = err as FhirSafetyError;
      expect(safetyError.locations).toEqual(["Observation.status"]);
      expect(safetyError.message).not.toContain("entered-in-error");
      expect(safetyError.message).not.toContain("synthetic panel");
    }
  });

  it("finds a duplicate nested inside a CodeableConcept, at its nested location", () => {
    const { resource } = parseResource(
      '{"resourceType":"Condition","clinicalStatus":{"coding":[{"code":"active","code":"resolved"}]}}',
    );
    expect(shadowedProperties(resource, "Condition")).toEqual([
      "Condition.clinicalStatus.coding[0].code",
    ]);
    expect(readSafety(resource).safeToSummarize).toBe(false);
  });

  it("finds a duplicate `_`-sibling too", () => {
    const { resource } = parseResource(
      '{"resourceType":"Observation","status":"final","_status":{"id":"a"},"_status":{"id":"b"}}',
    );
    expect(shadowedProperties(resource, "Observation")).toEqual(["Observation.status"]);
    expect(readSafety(resource).safeToSummarize).toBe(false);
  });

  it("does not let a duplicate hide an unhandled modifierExtension", () => {
    // The second `extension` member carries the modifier; a reader that dropped it would report the
    // resource as safe to flatten.
    const { resource } = parseResource(
      '{"resourceType":"Patient","extension":[],' +
        '"extension":[{"modifierExtension":[{"url":"http://example.org/synthetic"}]}]}',
    );
    expect(readSafety(resource).unhandledModifierExtensions).toEqual([
      "Patient.extension[0].modifierExtension[0]",
    ]);
  });

  it("keeps the retraction read fail-safe on verificationStatus as well", () => {
    const { resource } = parseResource(
      '{"resourceType":"Condition","verificationStatus":{"coding":[{"code":"confirmed"}]},' +
        '"verificationStatus":{"coding":[{"code":"entered-in-error"}]}}',
    );
    expect(isRetracted(resource)).toBe(true);
    expect(readSafety(resource).negations).toContain("entered-in-error");
  });
});

/**
 * Every negation kind, not only the retraction the defect was reported against. `readSafety` calls
 * `negations` the authoritative safety read, so each one has to survive the same duplicate that
 * hid the retraction: a negation reported for one kind and silently dropped for the other five would
 * be the same defect wearing a different code.
 */
describe("every negation kind is read across all the values written for its element", () => {
  it("finds `refuted` in a shadowed verificationStatus", () => {
    const { resource } = parseResource(
      '{"resourceType":"Condition","verificationStatus":{"coding":[{"code":"confirmed"}]},' +
        '"verificationStatus":{"coding":[{"code":"refuted"}]}}',
    );
    expect(readSafety(resource).negations).toContain("refuted");
  });

  it("finds a retraction in a duplicate `code` inside one Coding", () => {
    const { resource } = parseResource(
      '{"resourceType":"Condition",' +
        '"verificationStatus":{"coding":[{"code":"confirmed","code":"entered-in-error"}]}}',
    );
    const safety = readSafety(resource);
    expect(safety.retracted).toBe(true);
    expect(safety.negations).toContain("entered-in-error");
    expect(validateResource(resource).issues.map((i) => i.code)).toContain("RETRACTED_RESOURCE");
  });

  it("finds `not-taken` in a shadowed MedicationStatement status", () => {
    const { resource } = parseResource(
      '{"resourceType":"MedicationStatement","status":"completed","status":"not-taken"}',
    );
    expect(readSafety(resource).negations).toContain("not-taken");
  });

  it("finds `not-done` in a shadowed Immunization status", () => {
    const { resource } = parseResource(
      '{"resourceType":"Immunization","status":"completed","status":"not-done"}',
    );
    expect(readSafety(resource).negations).toContain("not-done");
  });

  it("finds `do-not-perform` in a shadowed doNotPerform, and surfaces it as true", () => {
    const { resource } = parseResource(
      '{"resourceType":"MedicationRequest","status":"active","doNotPerform":false,' +
        '"doNotPerform":true}',
    );
    const safety = readSafety(resource);
    expect(safety.doNotPerform).toBe(true);
    expect(safety.negations).toContain("do-not-perform");
  });

  it("finds a recorded no-known-allergy in a shadowed AllergyIntolerance code", () => {
    // SNOMED CT 716186003 "No known allergy", the one concept this library encodes by identity.
    const { resource } = parseResource(
      '{"resourceType":"AllergyIntolerance","code":{"text":"synthetic"},' +
        '"code":{"coding":[{"system":"http://snomed.info/sct","code":"716186003"}]}}',
    );
    const safety = readSafety(resource);
    expect(safety.noKnownAllergy).toBe(true);
    expect(safety.negations).toContain("no-known-allergy");
  });

  it("leaves a conformant multi-coding CodeableConcept reading exactly as before", () => {
    const { resource } = parseResource(
      '{"resourceType":"Condition","clinicalStatus":{"coding":[' +
        '{"system":"http://terminology.hl7.org/CodeSystem/condition-clinical","code":"active"},' +
        '{"system":"http://example.org/local","code":"A"}]}}',
    );
    const safety = readSafety(resource);
    expect(safety.clinicalStatus).toBe("active");
    expect(safety.negations).toEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });
});

describe("the `_`-sibling resolves a repeated name the same way the rest of the codec does", () => {
  const META_DUP =
    '{"resourceType":"Patient","birthDate":"1970-01-01","_birthDate":{"id":"a","id":"b"}}';

  it("is first-wins, not last-wins (one rule across the whole codec)", () => {
    const { resource } = parseResource(META_DUP);
    const birthDate = getProperty(resource, "birthDate");
    expect(birthDate?.kind === "primitive" ? birthDate.id : undefined).toBe("a");
  });

  it("reports it rather than dropping it in silence", () => {
    const { issues } = parseResource(META_DUP);
    expect(issues).toContainEqual({
      code: ISSUE_CODES.DUPLICATE_PROPERTY,
      severity: "warning",
      expression: "Patient.birthDate.id",
    });
  });

  it("stops at the read issue: the carve-out is real and is what the docs claim", () => {
    // A primitive's `_`-sibling is an R4 Element (`id` and `extension`, never `modifierExtension`),
    // so nothing in it can make a safety verdict wrong. The read issue is the whole of the report:
    // no model slot, no validation error, no refusal. Pinned so the doc claim stays executable.
    const { resource } = parseResource(META_DUP);
    expect(readSafety(resource).shadowedProperties).toEqual([]);
    expect(readSafety(resource).safeToSummarize).toBe(true);
    expect(validateResource(resource).issues.map((i) => i.code)).not.toContain(
      "DUPLICATE_PROPERTY",
    );
  });
});

describe("a location is reported once per element, however many members shadowed it", () => {
  it("collapses a repeated name and a repeated `_`-sibling onto one location", () => {
    const { resource, issues } = parseResource(
      '{"resourceType":"Observation","status":"final","status":"amended",' +
        '"_status":{"id":"a"},"_status":{"id":"b"}}',
    );
    expect(
      issues.filter((i) => i.code === ISSUE_CODES.DUPLICATE_PROPERTY).map((i) => i.expression),
    ).toEqual(["Observation.status"]);
    expect(readSafety(resource).shadowedProperties).toEqual(["Observation.status"]);
    expect(
      validateResource(resource).issues.filter((i) => i.code === "DUPLICATE_PROPERTY"),
    ).toHaveLength(1);
  });

  it("still reports two different objects separately, even when their paths read the same", () => {
    // `code` is repeated, and each of the two `code` objects repeats `text`. That is two distinct
    // defects on two distinct objects; FHIRPath cannot tell the objects apart, so the two locations
    // read identically. Collapsing them would claim one defect where the document has two.
    const { resource } = parseResource(
      '{"resourceType":"Observation","code":{"text":"a","text":"b"},"code":{"text":"c","text":"d"}}',
    );
    // Walk order: the surviving `code` object's own duplicate, then the repeated `code` itself,
    // then the shadowed `code` object's duplicate.
    expect(readSafety(resource).shadowedProperties).toEqual([
      "Observation.code.text",
      "Observation.code",
      "Observation.code.text",
    ]);
  });
});

describe("the validator rejects a document that broke the unique-name rule", () => {
  it("emits DUPLICATE_PROPERTY as an error and reports the resource invalid", () => {
    const { resource } = parseResource(RETRACTION_LAST);
    const { issues, valid } = validateResource(resource);
    expect(valid).toBe(false);
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "DUPLICATE_PROPERTY",
        severity: "error",
        type: "structure",
        expression: "Observation.status",
      }),
    );
  });

  it("still surfaces the retraction, located at status, from the shadowed member", () => {
    const { resource } = parseResource(RETRACTION_LAST);
    const { issues } = validateResource(resource);
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "RETRACTED_RESOURCE",
        severity: "information",
        expression: "Observation.status",
      }),
    );
  });
});

describe("the write path stays spec-clean, and equivalence stays honest", () => {
  it("emits one member per name (a duplicate is never written back out)", () => {
    const { resource } = parseResource(RETRACTION_LAST);
    const out = serializeResource(resource);
    expect(out).toBe(
      '{"resourceType":"Observation","status":"final","code":{"text":"synthetic panel"}}',
    );
    // The emitted document is conformant: reading it back raises no duplicate issue.
    expect(codes(parseResource(out).issues)).not.toContain(ISSUE_CODES.DUPLICATE_PROPERTY);
  });

  it("does not call a document with a shadowed member equivalent to one without it", () => {
    const json = parseResource(RETRACTION_LAST);
    const xml = parseResourceXml(
      '<Observation xmlns="http://hl7.org/fhir"><status value="final"/>' +
        '<code><text value="synthetic panel"/></code></Observation>',
    );
    expect(nodesEquivalent(json.resource, xml.resource)).toBe(false);
    // Without the duplicate the two wire formats agree, so the `false` above is the duplicate, not a
    // mapping difference.
    const clean = parseResource(serializeResource(json.resource));
    expect(nodesEquivalent(clean.resource, xml.resource)).toBe(true);
  });
});
