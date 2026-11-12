import { describe, expect, it } from "vitest";

import {
  buildRegistry,
  collectProfileIssues,
  decimal,
  FhirDecimal,
  generateSnapshot,
  loadStructureDefinition,
  parseResource,
  parseResourceXml,
  PROFILE_UNCHECKED_CONSTRAINTS,
  serializeResource,
  validateResource,
  type FhirComplex,
  type StructureDefinition,
  type ValidationIssue,
} from "../src/index.js";
import { compareDecimals } from "../src/model/decimal.js";
import { req } from "./_util.js";

/**
 * Validating a resource directly against a profile checks the profile's narrowed types, reference
 * targets, `maxLength`, `minValue[x]` and `maxValue[x]`, or reports each constraint it does not
 * check as `PROFILE_CONSTRAINT_UNCHECKED` at the element: never a clean result over a constraint
 * nobody looked at. Every profile and document here is synthetic: example.org canonicals, plainly
 * fake ids, codes and names.
 */

const BASE = "http://example.org/StructureDefinition/";
const CORE = "http://hl7.org/fhir/StructureDefinition/";

function sd(
  type: string,
  elements: readonly Record<string, unknown>[],
  url = "fake",
): StructureDefinition {
  return req(
    loadStructureDefinition(
      parseResource(
        JSON.stringify({
          resourceType: "StructureDefinition",
          url: `${BASE}${url}`,
          type,
          snapshot: { element: [{ id: type, path: type }, ...elements] },
        }),
      ).resource,
    ),
  );
}

function parse(obj: unknown): FhirComplex {
  return parseResource(JSON.stringify(obj)).resource;
}

/** The profile layer's findings, as [code, location, unchecked kind or invariant key]. */
function profileFindings(issues: readonly ValidationIssue[]): [string, string, string?][] {
  return issues
    .filter((i) => i.code.startsWith("PROFILE_") || i.constraint === "sqty-1")
    .map((i) => {
      const detail = i.uncheckedConstraint ?? i.constraint;
      return detail === undefined ? [i.code, i.expression] : [i.code, i.expression, detail];
    });
}

const OBS = { resourceType: "Observation", status: "final", code: { text: "fake" } };

describe("a narrowed choice type", () => {
  const quantityOnly = sd("Observation", [
    { id: "Observation.value[x]", path: "Observation.value[x]", type: [{ code: "Quantity" }] },
  ]);

  it("draws an error on a variant the profile does not list, and nothing on one it does", () => {
    const wrong = validateResource(parse({ ...OBS, valueString: "fake" }), {
      profiles: [quantityOnly],
    });
    expect(profileFindings(wrong.issues)).toEqual([
      ["PROFILE_TYPE_MISMATCH", "Observation.value[x]"],
    ]);
    expect(wrong.valid).toBe(false);

    const right = validateResource(parse({ ...OBS, valueQuantity: { value: 1 } }), {
      profiles: [quantityOnly],
    });
    expect(profileFindings(right.issues)).toEqual([]);
    expect(right.valid).toBe(true);
  });

  it("matches a primitive type code to its capitalized suffix", () => {
    const dateTimeOnly = sd("Observation", [
      {
        id: "Observation.effective[x]",
        path: "Observation.effective[x]",
        type: [{ code: "dateTime" }],
      },
    ]);
    const issues = (doc: object): [string, string, string?][] =>
      profileFindings(collectProfileIssues(parse({ ...OBS, ...doc }), dateTimeOnly));
    expect(issues({ effectiveDateTime: "2020-01-01" })).toEqual([]);
    expect(issues({ effectivePeriod: { start: "2020-01-01" } })).toEqual([
      ["PROFILE_TYPE_MISMATCH", "Observation.effective[x]"],
    ]);
  });

  it("checks a choice element with no type list against nothing", () => {
    const untyped = sd("Observation", [
      { id: "Observation.value[x]", path: "Observation.value[x]" },
    ]);
    expect(collectProfileIssues(parse({ ...OBS, valueString: "fake" }), untyped)).toEqual([]);
  });

  it("checks each repeat of a sliced choice's member against its slice", () => {
    const sliced = sd("Observation", [
      { id: "Observation.component", path: "Observation.component" },
      {
        id: "Observation.component.value[x]",
        path: "Observation.component.value[x]",
        type: [{ code: "Quantity" }, { code: "string" }],
      },
    ]);
    const doc = parse({
      ...OBS,
      component: [
        { code: { text: "fake-a" }, valueQuantity: { value: 1 } },
        { code: { text: "fake-b" }, valueBoolean: true },
      ],
    });
    expect(profileFindings(collectProfileIssues(doc, sliced))).toEqual([
      ["PROFILE_TYPE_MISMATCH", "Observation.component[1].value[x]"],
    ]);
  });
});

describe("a reference's target profiles", () => {
  const subjectProfile = (targets: readonly string[], code = "Reference"): StructureDefinition =>
    sd("Observation", [
      {
        id: "Observation.subject",
        path: "Observation.subject",
        type: [{ code, targetProfile: targets }],
      },
    ]);
  const patientOnly = subjectProfile([`${CORE}Patient`]);
  const findings = (
    profile: StructureDefinition,
    doc: object,
    profiles: readonly StructureDefinition[] = [],
  ): [string, string, string?][] =>
    profileFindings(collectProfileIssues(parse({ ...OBS, ...doc }), profile, { profiles }));

  it("draws an error on a reference whose Type/id names a type no target profile allows", () => {
    expect(findings(patientOnly, { subject: { reference: "Group/fake-1" } })).toEqual([
      ["PROFILE_REFERENCE_TARGET_MISMATCH", "Observation.subject"],
    ]);
    expect(findings(patientOnly, { subject: { reference: "Patient/fake-1" } })).toEqual([]);
    expect(
      findings(patientOnly, { subject: { reference: `${CORE.slice(0, 19)}fhir/Patient/fake-1` } }),
    ).toEqual([]);
    expect(
      validateResource(parse({ ...OBS, subject: { reference: "Group/fake-1" } }), {
        profiles: [patientOnly],
      }).valid,
    ).toBe(false);
  });

  it("reads the type of a contained target, not the reference's text", () => {
    const doc = {
      contained: [{ resourceType: "Group", id: "g1", type: "person", actual: true }],
      subject: { reference: "#g1" },
    };
    expect(findings(patientOnly, doc)).toEqual([
      ["PROFILE_REFERENCE_TARGET_MISMATCH", "Observation.subject"],
    ]);
    const patientDoc = {
      contained: [{ resourceType: "Patient", id: "p1" }],
      subject: { reference: "#p1" },
    };
    expect(findings(patientOnly, patientDoc)).toEqual([]);
  });

  it("reports a target whose type cannot be read as not checked", () => {
    const unchecked = [["PROFILE_CONSTRAINT_UNCHECKED", "Observation.subject", "target-profile"]];
    expect(findings(patientOnly, { subject: { display: "fake" } })).toEqual(unchecked);
    expect(
      findings(patientOnly, {
        subject: { reference: "urn:uuid:00000000-0000-4000-8000-000000000000" },
      }),
    ).toEqual(unchecked);
    expect(findings(patientOnly, { subject: { reference: "#absent" } })).toEqual(unchecked);
    expect(findings(patientOnly, { subject: { reference: "patient/fake-1" } })).toEqual(unchecked);
  });

  it("allows any target under Resource or DomainResource", () => {
    for (const any of [`${CORE}Resource`, `${CORE}DomainResource|4.0.1`]) {
      expect(findings(subjectProfile([any]), { subject: { reference: "Group/fake-1" } })).toEqual(
        [],
      );
      // Beside a narrower one, it still allows any target.
      expect(
        findings(subjectProfile([`${CORE}Patient`, any]), {
          subject: { reference: "Group/fake-1" },
        }),
      ).toEqual([]);
    }
  });

  it("reads a pinned base canonical's type and passes any target of one of several", () => {
    const either = subjectProfile([`${CORE}Group|4.0.1`, `${CORE}Patient`]);
    expect(findings(either, { subject: { reference: "Patient/fake-1" } })).toEqual([]);
    expect(findings(either, { subject: { reference: "Group/fake-1" } })).toEqual([]);
    expect(findings(either, { subject: { reference: "Device/fake-1" } })).toEqual([
      ["PROFILE_REFERENCE_TARGET_MISMATCH", "Observation.subject"],
    ]);
  });

  it("reports a target of a constraining profile's type as not checked, and errs on another type", () => {
    const fakePatient = sd("Patient", [], "fake-patient");
    const constrained = subjectProfile([`${BASE}fake-patient`]);
    expect(
      findings(constrained, { subject: { reference: "Patient/fake-1" } }, [fakePatient]),
    ).toEqual([["PROFILE_CONSTRAINT_UNCHECKED", "Observation.subject", "target-profile"]]);
    expect(
      findings(constrained, { subject: { reference: "Group/fake-1" } }, [fakePatient]),
    ).toEqual([["PROFILE_REFERENCE_TARGET_MISMATCH", "Observation.subject"]]);
    // A profile nobody supplied names no type, so nothing is decided against it.
    expect(findings(constrained, { subject: { reference: "Group/fake-1" } })).toEqual([
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.subject", "target-profile"],
    ]);
    // A lower-case core tail is a profile, not a type.
    const vitals = subjectProfile([`${CORE}vitalsigns`, `${CORE}Patient`]);
    expect(findings(vitals, { subject: { reference: "Group/fake-1" } })).toEqual([
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.subject", "target-profile"],
    ]);
  });

  it("reports a canonical's target profile as not checked, and a type without one as nothing", () => {
    const canonical = sd("Observation", [
      {
        id: "Observation.focus",
        path: "Observation.focus",
        type: [
          { code: "canonical", targetProfile: [`${CORE}Questionnaire`] },
          { code: "Reference" },
        ],
      },
    ]);
    expect(
      profileFindings(
        collectProfileIssues(parse({ ...OBS, focus: [{ reference: "Group/fake-1" }] }), canonical),
      ),
    ).toEqual([["PROFILE_CONSTRAINT_UNCHECKED", "Observation.focus", "target-profile"]]);
  });

  it("checks a reference choice variant against its own type's targets", () => {
    const choice = sd("Observation", [
      {
        id: "Observation.value[x]",
        path: "Observation.value[x]",
        type: [{ code: "string" }, { code: "Reference", targetProfile: [`${CORE}Patient`] }],
      },
    ]);
    const issues = (doc: object): [string, string, string?][] =>
      profileFindings(collectProfileIssues(parse({ ...OBS, ...doc }), choice));
    expect(issues({ valueString: "fake" })).toEqual([]);
    expect(issues({ valueReference: { reference: "Group/fake-1" } })).toEqual([
      ["PROFILE_REFERENCE_TARGET_MISMATCH", "Observation.value[x]"],
    ]);
  });
});

describe("maxLength", () => {
  const short = sd("Patient", [
    { id: "Patient.name", path: "Patient.name" },
    { id: "Patient.name.family", path: "Patient.name.family", maxLength: 5 },
  ]);
  const findings = (doc: object): [string, string, string?][] =>
    profileFindings(collectProfileIssues(parse({ resourceType: "Patient", ...doc }), short));

  it("draws an error on a longer string and nothing at the limit", () => {
    expect(findings({ name: [{ family: "Chalmers" }] })).toEqual([
      ["PROFILE_MAX_LENGTH", "Patient.name.family"],
    ]);
    expect(findings({ name: [{ family: "James" }] })).toEqual([]);
    expect(findings({ name: [{ family: "James" }, { family: "Chalmers" }] })).toEqual([
      ["PROFILE_MAX_LENGTH", "Patient.name[1].family"],
    ]);
    expect(
      validateResource(parse({ resourceType: "Patient", name: [{ family: "Chalmers" }] }), {
        profiles: [short],
      }).valid,
    ).toBe(false);
  });

  it("measures nothing on a value-less primitive and reports a non-string as not checked", () => {
    expect(
      findings({ name: [{ _family: { extension: [{ url: `${BASE}x`, valueBoolean: true }] } }] }),
    ).toEqual([]);
    const onNumber = sd("Patient", [
      { id: "Patient.active", path: "Patient.active", maxLength: 1 },
    ]);
    expect(
      profileFindings(
        collectProfileIssues(parse({ resourceType: "Patient", active: true }), onNumber),
      ),
    ).toEqual([["PROFILE_CONSTRAINT_UNCHECKED", "Patient.active", "max-length"]]);
  });

  it("keeps the tighter of a base's and a differential's maxLength", () => {
    const base = sd(
      "Patient",
      [{ id: "Patient.gender", path: "Patient.gender", maxLength: 4 }],
      "fake-base",
    );
    const derived = (maxLength: number): StructureDefinition =>
      req(
        loadStructureDefinition(
          parse({
            resourceType: "StructureDefinition",
            url: `${BASE}fake-derived`,
            type: "Patient",
            baseDefinition: `${BASE}fake-base`,
            differential: {
              element: [{ id: "Patient.gender", path: "Patient.gender", maxLength }],
            },
          }),
        ),
      );
    const resolve = (url: string): StructureDefinition | undefined =>
      url === `${BASE}fake-base` ? base : undefined;
    const issues = (maxLength: number, gender: string): [string, string, string?][] =>
      profileFindings(
        collectProfileIssues(parse({ resourceType: "Patient", gender }), derived(maxLength), {
          resolve,
        }),
      );
    expect(issues(9, "other")).toEqual([["PROFILE_MAX_LENGTH", "Patient.gender"]]);
    expect(issues(3, "male")).toEqual([["PROFILE_MAX_LENGTH", "Patient.gender"]]);
    expect(issues(9, "male")).toEqual([]);
  });
});

describe("minValue and maxValue", () => {
  const range = (bounds: Record<string, unknown>, type = "integer"): StructureDefinition =>
    sd("Observation", [
      {
        id: "Observation.value[x]",
        path: "Observation.value[x]",
        type: [{ code: type }],
        ...bounds,
      },
    ]);
  const findings = (profile: StructureDefinition, doc: object): [string, string, string?][] =>
    profileFindings(collectProfileIssues(parse({ ...OBS, ...doc }), profile));

  it("draws an error below the minimum and above the maximum, and nothing at either", () => {
    const zeroToTen = range({ minValueInteger: 0, maxValueInteger: 10 });
    expect(findings(zeroToTen, { valueInteger: -1 })).toEqual([
      ["PROFILE_MIN_VALUE", "Observation.value[x]"],
    ]);
    expect(findings(zeroToTen, { valueInteger: 11 })).toEqual([
      ["PROFILE_MAX_VALUE", "Observation.value[x]"],
    ]);
    expect(findings(zeroToTen, { valueInteger: 0 })).toEqual([]);
    expect(findings(zeroToTen, { valueInteger: 10 })).toEqual([]);
    expect(
      validateResource(parse({ ...OBS, valueInteger: 11 }), { profiles: [zeroToTen] }).valid,
    ).toBe(false);
  });

  it("compares decimals exactly, whatever their spelling", () => {
    const decimals = req(
      loadStructureDefinition(
        parseResource(
          '{"resourceType":"StructureDefinition","url":"http://example.org/StructureDefinition/fake",' +
            '"type":"Observation","snapshot":{"element":[{"id":"Observation","path":"Observation"},' +
            '{"id":"Observation.value[x]","path":"Observation.value[x]","type":[{"code":"decimal"}],' +
            '"minValueDecimal":0.25,"maxValueDecimal":2.5e1}]}}',
        ).resource,
      ),
    );
    const at = (value: string): [string, string, string?][] =>
      profileFindings(
        collectProfileIssues(
          parseResource(
            `{"resourceType":"Observation","status":"final","code":{"text":"fake"},"valueDecimal":${value}}`,
          ).resource,
          decimals,
        ),
      );
    expect(at("0.2500")).toEqual([]);
    expect(at("25.000")).toEqual([]);
    expect(at("0.249")).toEqual([["PROFILE_MIN_VALUE", "Observation.value[x]"]]);
    expect(at("-1e3")).toEqual([["PROFILE_MIN_VALUE", "Observation.value[x]"]]);
    expect(at("25.01")).toEqual([["PROFILE_MAX_VALUE", "Observation.value[x]"]]);
    expect(at("1e9999")).toEqual([["PROFILE_MAX_VALUE", "Observation.value[x]"]]);
  });

  it("reports a bound of another type, or an occurrence of another type, as not checked", () => {
    const dates = range({ minValueDate: "2020-01-01" }, "date");
    expect(findings(dates, { valueDateTime: "2019-01-01" })).toEqual([
      ["PROFILE_TYPE_MISMATCH", "Observation.value[x]"],
    ]);
    const dateTimes = range({ maxValueDateTime: "2020-01-01" }, "dateTime");
    expect(findings(dateTimes, { valueDateTime: "2021-01-01" })).toEqual([
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.value[x]", "value-range"],
    ]);
    const mixed = sd("Observation", [
      {
        id: "Observation.value[x]",
        path: "Observation.value[x]",
        type: [{ code: "integer" }, { code: "string" }],
        maxValueInteger: 3,
      },
    ]);
    expect(findings(mixed, { valueString: "fake" })).toEqual([
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.value[x]", "value-range"],
    ]);
    expect(findings(mixed, { valueInteger: 2 })).toEqual([]);
  });

  it("reads a non-choice element's own type, an XML-read number, and skips a value-less one", () => {
    const xmlProfile = req(
      loadStructureDefinition(
        parseResourceXml(
          '<StructureDefinition xmlns="http://hl7.org/fhir"><url value="http://example.org/StructureDefinition/fake-x"/>' +
            '<type value="Patient"/><snapshot><element><path value="Patient"/></element>' +
            '<element><path value="Patient.multipleBirth[x]"/><type><code value="integer"/></type>' +
            '<maxValueInteger value="3"/></element></snapshot></StructureDefinition>',
        ).resource,
      ),
    );
    const xmlDoc = (n: string): FhirComplex =>
      parseResourceXml(
        `<Patient xmlns="http://hl7.org/fhir"><multipleBirthInteger value="${n}"/></Patient>`,
      ).resource;
    expect(profileFindings(collectProfileIssues(xmlDoc("4"), xmlProfile))).toEqual([
      ["PROFILE_MAX_VALUE", "Patient.multipleBirth[x]"],
    ]);
    expect(profileFindings(collectProfileIssues(xmlDoc("3"), xmlProfile))).toEqual([]);

    const count = sd("Patient", [
      { id: "Patient.name", path: "Patient.name" },
      {
        id: "Patient.name.given",
        path: "Patient.name.given",
        type: [{ code: "string" }],
        minValueInteger: 1,
      },
    ]);
    expect(
      profileFindings(
        collectProfileIssues(
          parse({
            resourceType: "Patient",
            name: [
              { given: [null], _given: [{ extension: [{ url: `${BASE}x`, valueBoolean: true }] }] },
            ],
          }),
          count,
        ),
      ),
    ).toEqual([]);
  });
});

describe("type profiles", () => {
  it("checks SimpleQuantity's one rule and reports any other type profile as not checked", () => {
    const profile = sd("Observation", [
      { id: "Observation.referenceRange", path: "Observation.referenceRange" },
      {
        id: "Observation.referenceRange.low",
        path: "Observation.referenceRange.low",
        type: [{ code: "Quantity", profile: [`${CORE}SimpleQuantity|4.0.1`] }],
      },
      {
        id: "Observation.referenceRange.high",
        path: "Observation.referenceRange.high",
        type: [{ code: "Quantity", profile: [`${BASE}fake-quantity`] }],
      },
    ]);
    const doc = (low: object): FhirComplex =>
      parse({ ...OBS, referenceRange: [{ low, high: { value: 9 } }] });
    expect(
      profileFindings(collectProfileIssues(doc({ value: 1, comparator: "<" }), profile)),
    ).toEqual([
      ["INVARIANT_VIOLATED", "Observation.referenceRange.low", "sqty-1"],
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.referenceRange.high", "type-profile"],
    ]);
    expect(profileFindings(collectProfileIssues(doc({ value: 1 }), profile))).toEqual([
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.referenceRange.high", "type-profile"],
    ]);
  });
});

describe("constraints reported as not checked", () => {
  const findings = (
    profile: StructureDefinition,
    doc: object,
    schema = true,
  ): [string, string, string?][] => {
    const resource = parse(doc);
    if (schema) return profileFindings(validateResource(resource, { profiles: [profile] }).issues);
    return profileFindings(collectProfileIssues(resource, profile));
  };

  it("passes a binding the structure layer enumerates, and reports any other", () => {
    const binding = (strength: string, valueSet: string): StructureDefinition =>
      sd("Observation", [
        { id: "Observation.status", path: "Observation.status", binding: { strength, valueSet } },
      ]);
    const observationStatus = "http://hl7.org/fhir/ValueSet/observation-status";
    const notChecked = [["PROFILE_CONSTRAINT_UNCHECKED", "Observation.status", "binding"]];
    expect(findings(binding("required", `${observationStatus}|4.0.1`), OBS)).toEqual([]);
    expect(findings(binding("extensible", observationStatus), OBS)).toEqual([]);
    expect(findings(binding("preferred", `${BASE}fake-vs`), OBS)).toEqual([]);
    expect(findings(binding("example", `${BASE}fake-vs`), OBS)).toEqual([]);
    expect(findings(binding("required", `${observationStatus}|5.0.0`), OBS)).toEqual(notChecked);
    expect(findings(binding("required", `${BASE}fake-vs`), OBS)).toEqual(notChecked);
    expect(findings(binding("fake-strength", observationStatus), OBS)).toEqual(notChecked);
    // Without the structure layer, nothing checked the binding.
    expect(findings(binding("required", observationStatus), OBS, false)).toEqual(notChecked);
    const noValueSet = sd("Observation", [
      { id: "Observation.status", path: "Observation.status", binding: { strength: "required" } },
    ]);
    expect(findings(noValueSet, OBS)).toEqual(notChecked);
    const nested = sd("Observation", [
      { id: "Observation.code", path: "Observation.code" },
      {
        id: "Observation.code.text",
        path: "Observation.code.text",
        binding: { strength: "required", valueSet: observationStatus },
      },
    ]);
    expect(findings(nested, OBS)).toEqual([
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.code.text", "binding"],
    ]);
    // An element the schema carries with no enumerated binding.
    const unbound = sd("Observation", [
      {
        id: "Observation.code",
        path: "Observation.code",
        binding: { strength: "extensible", valueSet: `${BASE}fake-vs` },
      },
    ]);
    expect(findings(unbound, OBS)).toEqual([
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.code", "binding"],
    ]);
  });

  it("reports what the model does not read, and passes what only documents an element", () => {
    const documentary = sd("Observation", [
      {
        id: "Observation.status",
        path: "Observation.status",
        short: "fake",
        definition: "fake",
        comment: "fake",
        requirements: "fake",
        alias: ["fake"],
        label: "fake",
        code: [{ code: "fake" }],
        base: { path: "Observation.status", min: 1, max: "1" },
        meaningWhenMissing: "fake",
        orderMeaning: "fake",
        example: [{ label: "fake", valueCode: "final" }],
        condition: ["fake-1"],
        isModifier: true,
        isModifierReason: "fake",
        isSummary: true,
        mapping: [{ identity: "fake", map: "fake" }],
        representation: ["xmlAttr"],
        sliceIsConstraining: false,
        mustSupport: false,
        min: 1,
        max: "1",
        fixedCode: "final",
        constraint: [{ key: "ele-1", severity: "error", expression: "true" }],
        extension: [
          ...[
            "http://hl7.org/fhir/StructureDefinition/elementdefinition-translatable",
            "http://hl7.org/fhir/StructureDefinition/structuredefinition-display-hint",
            "http://hl7.org/fhir/StructureDefinition/structuredefinition-standards-status",
            "http://hl7.org/fhir/StructureDefinition/structuredefinition-explicit-type-name",
            "http://hl7.org/fhir/StructureDefinition/structuredefinition-fhir-type",
            "http://hl7.org/fhir/StructureDefinition/structuredefinition-hierarchy",
            "http://hl7.org/fhir/StructureDefinition/elementdefinition-type-must-support",
            "http://hl7.org/fhir/StructureDefinition/obligation",
            "http://hl7.org/fhir/us/core/StructureDefinition/uscdi-requirement",
          ].map((url) => ({ url, valueBoolean: true })),
        ],
        type: [
          {
            code: "code",
            extension: [{ url: `${CORE}structuredefinition-fhir-type`, valueUrl: "code" }],
          },
        ],
        binding: {
          strength: "example",
          description: "fake",
          valueSet: `${BASE}fake-vs`,
          extension: [
            { url: `${CORE}elementdefinition-bindingName`, valueString: "fake" },
            { url: `${CORE}elementdefinition-isCommonBinding`, valueBoolean: true },
          ],
        },
      },
    ]);
    expect(findings(documentary, OBS, false)).toEqual([]);

    const unread = (statement: Record<string, unknown>): [string, string, string?][] =>
      findings(
        sd("Observation", [{ id: "Observation.status", path: "Observation.status", ...statement }]),
        OBS,
        false,
      );
    const notChecked = [["PROFILE_CONSTRAINT_UNCHECKED", "Observation.status", "unread"]];
    expect(unread({ contentReference: "#Observation.status" })).toEqual(notChecked);
    expect(unread({ extension: [{ url: `${BASE}fake-ext`, valueBoolean: true }] })).toEqual(
      notChecked,
    );
    expect(unread({ extension: [{ valueBoolean: true }] })).toEqual(notChecked);
    expect(unread({ type: [{ code: "code", aggregation: ["contained"] }] })).toEqual(notChecked);
    expect(unread({ type: [{ code: "code", extension: [{ url: `${BASE}fake-ext` }] }] })).toEqual(
      notChecked,
    );
    expect(
      unread({ binding: { strength: "example", extension: [{ url: `${BASE}fake-ext` }] } }),
    ).toEqual(notChecked);
    expect(unread({ binding: { strength: "example", fakeMember: "fake" } })).toEqual(notChecked);
    expect(unread({ binding: { valueSet: `${BASE}fake-vs` } })).toEqual(notChecked);
    expect(unread({ binding: "fake" })).toEqual(notChecked);
    expect(unread({ constraint: [{ key: "fake-1" }] })).toEqual(notChecked);
    expect(unread({ constraint: { key: "ele-1", expression: "true" } })).toEqual([]);
    // An element absent from the document asks nothing of it.
    expect(
      findings(
        sd("Observation", [
          { id: "Observation.issued", path: "Observation.issued", contentReference: "#x" },
        ]),
        OBS,
        false,
      ),
    ).toEqual([]);
  });

  it("keeps what neither the base nor a differential reads, from both", () => {
    const base = sd(
      "Observation",
      [{ id: "Observation.status", path: "Observation.status", contentReference: "#x" }],
      "fake-base",
    );
    const derived = (element: Record<string, unknown>): StructureDefinition =>
      req(
        loadStructureDefinition(
          parse({
            resourceType: "StructureDefinition",
            url: `${BASE}fake-derived`,
            type: "Observation",
            baseDefinition: `${BASE}fake-base`,
            differential: {
              element: [{ id: "Observation.status", path: "Observation.status", ...element }],
            },
          }),
        ),
      );
    const resolve = (url: string): StructureDefinition | undefined =>
      url === `${BASE}fake-base` ? base : undefined;
    const unmodeledOf = (profile: StructureDefinition): readonly string[] | undefined =>
      generateSnapshot(profile, resolve).find((e) => e.path === "Observation.status")?.unmodeled;
    expect(unmodeledOf(derived({ short: "fake" }))).toEqual(["contentReference"]);
    expect(unmodeledOf(derived({ orderMeaning: "fake", fakeMember: true }))).toEqual([
      "contentReference",
      "fakeMember",
    ]);
    expect(unmodeledOf(derived({ contentReference: "#y" }))).toEqual(["contentReference"]);
    // A base that states nothing unread takes the differential's alone.
    const plain = sd(
      "Observation",
      [{ id: "Observation.status", path: "Observation.status" }],
      "fake-plain",
    );
    const fromPlain = req(
      loadStructureDefinition(
        parse({
          resourceType: "StructureDefinition",
          url: `${BASE}fake-from-plain`,
          type: "Observation",
          baseDefinition: `${BASE}fake-plain`,
          differential: {
            element: [{ id: "Observation.status", path: "Observation.status", fakeMember: true }],
          },
        }),
      ),
    );
    expect(
      generateSnapshot(fromPlain, (url) => (url === `${BASE}fake-plain` ? plain : undefined)).find(
        (e) => e.path === "Observation.status",
      )?.unmodeled,
    ).toEqual(["fakeMember"]);
    expect(
      collectProfileIssues(parse(OBS), derived({ short: "fake" }), { resolve }).map(
        (i) => i.uncheckedConstraint,
      ),
    ).toEqual(["unread"]);
  });

  it("reports an ordered or openAtEnd slicing over more than one occurrence", () => {
    const slicing = (s: Record<string, unknown>): StructureDefinition =>
      sd("Observation", [
        {
          id: "Observation.category",
          path: "Observation.category",
          slicing: { discriminator: [{ type: "value", path: "text" }], ...s },
        },
      ]);
    const one = { ...OBS, category: [{ text: "fake-a" }] };
    const two = { ...OBS, category: [{ text: "fake-a" }, { text: "fake-b" }] };
    const notChecked = [["PROFILE_CONSTRAINT_UNCHECKED", "Observation.category", "slice-order"]];
    expect(findings(slicing({ ordered: true, rules: "open" }), two, false)).toEqual(notChecked);
    expect(findings(slicing({ rules: "openAtEnd" }), two, false)).toEqual(notChecked);
    expect(findings(slicing({ ordered: true }), one, false)).toEqual([]);
    expect(findings(slicing({ ordered: false, rules: "closed" }), two, false)).toEqual([
      ["PROFILE_SLICE_UNMATCHED", "Observation.category[0]"],
      ["PROFILE_SLICE_UNMATCHED", "Observation.category[1]"],
    ]);
  });

  it("reports a slice's own invariant and checks the slice's members' own constraints", () => {
    const profile = sd("Observation", [
      {
        id: "Observation.category",
        path: "Observation.category",
        slicing: { discriminator: [{ type: "pattern", path: "$this" }], rules: "open" },
        constraint: [{ key: "ele-1", severity: "error", expression: "fake" }],
      },
      {
        id: "Observation.category:fake",
        path: "Observation.category",
        sliceName: "fake",
        patternCodeableConcept: { text: "fake-a" },
        constraint: [
          { key: "ele-1", severity: "error", expression: "fake" },
          { key: "fake-1", severity: "error", expression: "text.exists()" },
        ],
        type: [{ code: "CodeableConcept", profile: [`${BASE}fake-cc`] }],
      },
    ]);
    const doc = { ...OBS, category: [{ text: "fake-b" }, { text: "fake-a" }] };
    expect(findings(profile, doc, false)).toEqual([
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.category:fake", "slice-invariant"],
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.category[1]", "type-profile"],
    ]);
    expect(findings(profile, { ...OBS, category: [{ text: "fake-a" }] }, false)).toEqual([
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.category:fake", "slice-invariant"],
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.category", "type-profile"],
    ]);
    // A slice with no member asks nothing; one whose invariants the sliced element shares adds nothing.
    expect(findings(profile, { ...OBS, category: [{ text: "fake-b" }] }, false)).toEqual([]);
    const shared = sd("Observation", [
      {
        id: "Observation.category",
        path: "Observation.category",
        slicing: { discriminator: [{ type: "pattern", path: "$this" }], rules: "open" },
        constraint: [{ key: "fake-1", severity: "error", expression: "text.exists()" }],
      },
      {
        id: "Observation.category:fake",
        path: "Observation.category",
        sliceName: "fake",
        patternCodeableConcept: { text: "fake-a" },
        constraint: [{ key: "fake-1", severity: "error", expression: "text.exists()" }],
      },
    ]);
    expect(findings(shared, { ...OBS, category: [{ text: "fake-a" }] }, false)).toEqual([]);
    const differs = sd("Observation", [
      {
        id: "Observation.category",
        path: "Observation.category",
        slicing: { discriminator: [{ type: "pattern", path: "$this" }], rules: "open" },
        constraint: [{ key: "fake-1", severity: "error", expression: "text.empty()" }],
      },
      {
        id: "Observation.category:fake",
        path: "Observation.category",
        sliceName: "fake",
        patternCodeableConcept: { text: "fake-a" },
        constraint: [{ key: "fake-1", severity: "error", expression: "text.exists()" }],
      },
    ]);
    expect(findings(differs, { ...OBS, category: [{ text: "fake-a" }] }, false)).toEqual([
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.category:fake", "slice-invariant"],
    ]);
    // A sliced element with no invariant of its own shares none.
    const bare = sd("Observation", [
      {
        id: "Observation.category",
        path: "Observation.category",
        slicing: { discriminator: [{ type: "pattern", path: "$this" }], rules: "open" },
      },
      {
        id: "Observation.category:fake",
        path: "Observation.category",
        sliceName: "fake",
        patternCodeableConcept: { text: "fake-a" },
        constraint: [{ key: "fake-1", severity: "error", expression: "text.exists()" }],
      },
    ]);
    expect(findings(bare, { ...OBS, category: [{ text: "fake-a" }] }, false)).toEqual([
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.category:fake", "slice-invariant"],
    ]);
  });

  it("reports an invariant on an element present as a primitive, other than ele-1", () => {
    const invariant = (key: string): StructureDefinition =>
      sd("Observation", [
        {
          id: "Observation.status",
          path: "Observation.status",
          constraint: [{ key, severity: "error", expression: "true" }],
        },
      ]);
    expect(findings(invariant("fake-1"), OBS, false)).toEqual([
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.status", "primitive-invariant"],
    ]);
    expect(findings(invariant("ele-1"), OBS, false)).toEqual([]);
    const both = sd("Observation", [
      {
        id: "Observation.status",
        path: "Observation.status",
        constraint: [
          { key: "ele-1", severity: "error", expression: "true" },
          { key: "fake-1", severity: "error", expression: "true" },
        ],
      },
    ]);
    expect(findings(both, OBS, false)).toEqual([
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.status", "primitive-invariant"],
    ]);
    const onComplex = sd("Observation", [
      {
        id: "Observation.code",
        path: "Observation.code",
        constraint: [{ key: "fake-1", severity: "error", expression: "true" }],
      },
    ]);
    expect(findings(onComplex, OBS, false)).toEqual([]);
  });

  it("names the unchecked kind in the OperationOutcome's details", () => {
    const profile = sd("Observation", [
      { id: "Observation.status", path: "Observation.status", contentReference: "#x" },
    ]);
    const outcome = validateResource(parse(OBS), { profiles: [profile] }).toOperationOutcome();
    const json = serializeResource(outcome);
    expect(json).toContain('"details":{"text":"unread"}');
    expect(PROFILE_UNCHECKED_CONSTRAINTS.UNREAD).toBe("unread");
  });
});

describe("what the model records it does not read", () => {
  const element = (statement: Record<string, unknown>): readonly string[] | undefined =>
    sd("Observation", [
      { id: "Observation.status", path: "Observation.status", ...statement },
    ]).snapshot?.find((e) => e.path === "Observation.status")?.unmodeled;

  it("names each statement once, under the part it sits in", () => {
    expect(element({ short: "fake" })).toBeUndefined();
    expect(element({ contentReference: "#x", xminValueInteger: 1 })).toEqual([
      "contentReference",
      "xminValueInteger",
    ]);
    expect(
      element({
        extension: [{ url: `${BASE}fake-ext` }, { url: `${BASE}fake-ext` }, { valueBoolean: true }],
      }),
    ).toEqual([`extension:${BASE}fake-ext`, "extension:"]);
    expect(element({ extension: { url: `${BASE}fake-ext` } })).toEqual([
      `extension:${BASE}fake-ext`,
    ]);
    expect(element({ extension: ["fake"] })).toEqual(["extension:"]);
    expect(
      element({
        binding: { strength: "example", fakeMember: 1, extension: [{ url: `${BASE}fake-ext` }] },
      }),
    ).toEqual(["binding.fakeMember", `binding.extension:${BASE}fake-ext`]);
    expect(element({ binding: { valueSet: `${BASE}fake-vs` } })).toEqual(["binding"]);
    expect(element({ binding: "fake" })).toEqual(["binding"]);
    expect(
      element({
        type: [
          { code: "code", aggregation: ["contained"], extension: [{ url: `${BASE}fake-ext` }] },
          "fake",
        ],
      }),
    ).toEqual(["type.aggregation", `type.extension:${BASE}fake-ext`]);
    expect(element({ type: ["fake"] })).toBeUndefined();
    expect(element({ type: { code: "code", versioning: "specific" } })).toEqual([
      "type.versioning",
    ]);
    expect(
      element({ constraint: [{ key: "fake-1" }, { key: "ele-1", expression: "true" }] }),
    ).toEqual(["constraint"]);
  });

  it("reads maxLength, minValue[x] and maxValue[x] off an element", () => {
    const el = sd("Observation", [
      {
        id: "Observation.status",
        path: "Observation.status",
        maxLength: 4,
        minValueInteger: 1,
        maxValueDecimal: 2.5,
      },
    ]).snapshot?.find((e) => e.path === "Observation.status");
    expect(el?.maxLength).toBe(4);
    expect(el?.minValue?.type).toBe("Integer");
    expect(el?.maxValue?.type).toBe("Decimal");
    expect(el?.unmodeled).toBeUndefined();
  });

  it("carries a differential's maxLength, minValue[x] and maxValue[x] into the snapshot", () => {
    const base = sd(
      "Patient",
      [
        {
          id: "Patient.multipleBirth[x]",
          path: "Patient.multipleBirth[x]",
          type: [{ code: "integer" }],
        },
        { id: "Patient.gender", path: "Patient.gender" },
      ],
      "fake-base",
    );
    const derived = req(
      loadStructureDefinition(
        parse({
          resourceType: "StructureDefinition",
          url: `${BASE}fake-derived`,
          type: "Patient",
          baseDefinition: `${BASE}fake-base`,
          differential: {
            element: [
              {
                id: "Patient.multipleBirth[x]",
                path: "Patient.multipleBirth[x]",
                minValueInteger: 2,
                maxValueInteger: 3,
              },
              { id: "Patient.gender", path: "Patient.gender", maxLength: 4 },
            ],
          },
        }),
      ),
    );
    const resolve = (url: string): StructureDefinition | undefined =>
      url === `${BASE}fake-base` ? base : undefined;
    const findingsFor = (doc: object): [string, string, string?][] =>
      profileFindings(
        collectProfileIssues(parse({ resourceType: "Patient", ...doc }), derived, { resolve }),
      );
    expect(findingsFor({ multipleBirthInteger: 1, gender: "other" })).toEqual([
      ["PROFILE_MIN_VALUE", "Patient.multipleBirth[x]"],
      ["PROFILE_MAX_LENGTH", "Patient.gender"],
    ]);
    expect(findingsFor({ multipleBirthInteger: 4, gender: "male" })).toEqual([
      ["PROFILE_MAX_VALUE", "Patient.multipleBirth[x]"],
    ]);
  });
});

describe("the edges of each check", () => {
  const findings = (
    elements: readonly Record<string, unknown>[],
    doc: object,
    type = "Observation",
  ): [string, string, string?][] =>
    profileFindings(
      collectProfileIssues(parse({ resourceType: type, ...doc }), sd(type, elements)),
    );

  it("reports two profiles on one type once, and two kinds at one place each", () => {
    expect(
      findings(
        [
          {
            id: "Observation.code",
            path: "Observation.code",
            type: [{ code: "CodeableConcept", profile: [`${BASE}fake-a`, `${BASE}fake-b`] }],
            maxLength: 3,
          },
        ],
        OBS,
      ),
    ).toEqual([
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.code", "type-profile"],
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.code", "max-length"],
    ]);
  });

  it("reads no comparator off a SimpleQuantity occurrence that is not complex", () => {
    expect(
      findings(
        [
          { id: "Observation.referenceRange", path: "Observation.referenceRange" },
          {
            id: "Observation.referenceRange.low",
            path: "Observation.referenceRange.low",
            type: [{ code: "Quantity", profile: [`${CORE}SimpleQuantity`] }],
          },
        ],
        { ...OBS, referenceRange: [{ low: 5 }] },
      ),
    ).toEqual([]);
  });

  it("reads a reference's type only from a reference that is an object with a type name", () => {
    const subject = [
      {
        id: "Observation.subject",
        path: "Observation.subject",
        type: [{ code: "Reference", targetProfile: [`${CORE}Patient`] }],
      },
    ];
    const unchecked = [["PROFILE_CONSTRAINT_UNCHECKED", "Observation.subject", "target-profile"]];
    expect(findings(subject, { ...OBS, subject: "Patient/fake-1" })).toEqual(unchecked);
    expect(findings(subject, { ...OBS, subject: { reference: "xPatient/fake-1" } })).toEqual(
      unchecked,
    );
    expect(findings(subject, { ...OBS, subject: { reference: "Patient1/fake-1" } })).toEqual(
      unchecked,
    );
  });

  it("reads a core canonical's whole tail as a type, and nothing else there", () => {
    const subject = (target: string): Record<string, unknown>[] => [
      {
        id: "Observation.subject",
        path: "Observation.subject",
        type: [{ code: "Reference", targetProfile: [target] }],
      },
    ];
    const group = { ...OBS, subject: { reference: "Group/fake-1" } };
    const unchecked = [["PROFILE_CONSTRAINT_UNCHECKED", "Observation.subject", "target-profile"]];
    expect(findings(subject(`${CORE}fakePatient`), group)).toEqual(unchecked);
    expect(findings(subject(`${CORE}Patient-fake`), group)).toEqual(unchecked);
    expect(findings(subject(`${CORE}Group`), group)).toEqual([]);
  });

  it("reports a maxLength on a complex value, a bound with no number, and an unreadable number", () => {
    expect(
      findings([{ id: "Observation.code", path: "Observation.code", maxLength: 3 }], OBS),
    ).toEqual([["PROFILE_CONSTRAINT_UNCHECKED", "Observation.code", "max-length"]]);
    const bound = (value: unknown): Record<string, unknown>[] => [
      {
        id: "Observation.value[x]",
        path: "Observation.value[x]",
        type: [{ code: "integer" }],
        maxValueInteger: value,
      },
    ];
    const notChecked = [["PROFILE_CONSTRAINT_UNCHECKED", "Observation.value[x]", "value-range"]];
    expect(findings(bound("fake"), { ...OBS, valueInteger: 1 })).toEqual(notChecked);
    expect(findings(bound(true), { ...OBS, valueInteger: 1 })).toEqual(notChecked);
    const xml = parseResourceXml(
      '<Patient xmlns="http://hl7.org/fhir"><multipleBirthInteger value="fake"/></Patient>',
    ).resource;
    const profile = sd("Patient", [
      {
        id: "Patient.multipleBirth[x]",
        path: "Patient.multipleBirth[x]",
        type: [{ code: "integer" }],
        minValueInteger: 1,
      },
    ]);
    expect(profileFindings(collectProfileIssues(xml, profile))).toEqual([
      ["PROFILE_CONSTRAINT_UNCHECKED", "Patient.multipleBirth[x]", "value-range"],
    ]);
  });

  it("compares positiveInt and unsignedInt bounds, and not a date that spells a number", () => {
    for (const [code, bound] of [
      ["positiveInt", "maxValuePositiveInt"],
      ["unsignedInt", "maxValueUnsignedInt"],
    ] as const) {
      const elements = [
        { id: "Observation.value[x]", path: "Observation.value[x]", type: [{ code }], [bound]: 2 },
      ];
      const suffix = code.charAt(0).toUpperCase() + code.slice(1);
      expect(findings(elements, { ...OBS, [`value${suffix}`]: 3 })).toEqual([
        ["PROFILE_MAX_VALUE", "Observation.value[x]"],
      ]);
    }
    expect(
      findings(
        [
          {
            id: "Patient.birthDate",
            path: "Patient.birthDate",
            type: [{ code: "date" }],
            minValueDate: "2021",
          },
        ],
        { birthDate: "2020" },
        "Patient",
      ),
    ).toEqual([["PROFILE_CONSTRAINT_UNCHECKED", "Patient.birthDate", "value-range"]]);
  });

  it("reads no own type for an element of no type or of several", () => {
    const notChecked = [
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.referenceRange.low.value", "value-range"],
    ];
    const doc = { ...OBS, referenceRange: [{ low: { value: 9 } }] };
    const elements = (types: readonly string[]): Record<string, unknown>[] => [
      { id: "Observation.referenceRange", path: "Observation.referenceRange" },
      { id: "Observation.referenceRange.low", path: "Observation.referenceRange.low" },
      {
        id: "Observation.referenceRange.low.value",
        path: "Observation.referenceRange.low.value",
        ...(types.length === 0 ? {} : { type: types.map((code) => ({ code })) }),
        maxValueDecimal: 5,
      },
    ];
    expect(findings(elements([]), doc)).toEqual(notChecked);
    expect(findings(elements(["decimal", "integer"]), doc)).toEqual(notChecked);
    expect(findings(elements(["decimal"]), doc)).toEqual([
      ["PROFILE_MAX_VALUE", "Observation.referenceRange.low.value"],
    ]);
  });
});

describe("the structure layer's value sets", () => {
  it("names the R4 value set each enumerated binding is", () => {
    const registry = buildRegistry();
    const valueSetOf = (type: string, element: string): string | undefined =>
      registry(type)?.elements[element]?.binding?.valueSet;
    const r4 = "http://hl7.org/fhir/ValueSet/";
    expect(
      [
        ["Patient", "gender"],
        ["Observation", "status"],
        ["DiagnosticReport", "status"],
        ["MedicationRequest", "status"],
        ["MedicationRequest", "intent"],
        ["MedicationRequest", "priority"],
        ["AllergyIntolerance", "type"],
        ["AllergyIntolerance", "category"],
        ["AllergyIntolerance", "criticality"],
        ["Immunization", "status"],
        ["MedicationStatement", "status"],
        ["Encounter", "status"],
        ["Procedure", "status"],
        ["DocumentReference", "status"],
        ["DocumentReference", "docStatus"],
      ].map(([type, element]) => valueSetOf(String(type), String(element))),
    ).toEqual(
      [
        "administrative-gender",
        "observation-status",
        "diagnostic-report-status",
        "medicationrequest-status",
        "medicationrequest-intent",
        "request-priority",
        "allergy-intolerance-type",
        "allergy-intolerance-category",
        "allergy-intolerance-criticality",
        "immunization-status",
        "medication-statement-status",
        "encounter-status",
        "event-status",
        "document-reference-status",
        "composition-status",
      ].map((name) => `${r4}${name}`),
    );
  });
});

describe("compareDecimals", () => {
  const cmp = (a: string, b: string): number | undefined => compareDecimals(decimal(a), decimal(b));

  it("orders by value, exactly, across signs, scales and exponents", () => {
    expect(cmp("0", "0.000")).toBe(0);
    expect(cmp("1.0", "1")).toBe(0);
    expect(cmp("0", "1")).toBeLessThan(0);
    expect(cmp("1", "0")).toBeGreaterThan(0);
    expect(cmp("-1", "0")).toBeLessThan(0);
    expect(cmp("0", "-1")).toBeGreaterThan(0);
    expect(cmp("-2", "-1")).toBeLessThan(0);
    expect(cmp("-1", "-2")).toBeGreaterThan(0);
    expect(cmp("-0.5", "-0.25")).toBeLessThan(0);
    expect(cmp("-0.25", "-0.5")).toBeGreaterThan(0);
    expect(cmp("-0.29", "-0.3")).toBeGreaterThan(0);
    expect(cmp("-0.3", "-0.29")).toBeLessThan(0);
    expect(cmp("0.29", "0.3")).toBeLessThan(0);
    expect(cmp("0.3", "0.29")).toBeGreaterThan(0);
    expect(cmp("25", "25.01")).toBeLessThan(0);
    expect(cmp("25.01", "25")).toBeGreaterThan(0);
    expect(cmp("1e9999999", "2")).toBeGreaterThan(0);
    expect(cmp("2", "1e9999999")).toBeLessThan(0);
    expect(cmp("-1e9999999", "-2")).toBeLessThan(0);
    expect(cmp("2.5e1", "25.000")).toBe(0);
    expect(cmp("100", "99")).toBeGreaterThan(0);
    expect(cmp("0", "0.5")).toBeLessThan(0);
    expect(cmp("0.5", "0")).toBeGreaterThan(0);
    expect(cmp("0", "-0.5")).toBeGreaterThan(0);
    expect(cmp("-0.5", "0")).toBeLessThan(0);
  });

  it("orders nothing that is not a decimal literal", () => {
    expect(compareDecimals(new FhirDecimal("fake"), decimal("1"))).toBeUndefined();
    expect(compareDecimals(decimal("1"), new FhirDecimal("fake"))).toBeUndefined();
  });
});
