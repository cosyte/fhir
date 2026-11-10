import { parseResource } from "@cosyte/fhir";
import type { FhirComplex, RawJson, RawMember } from "@cosyte/fhir";
import fc from "fast-check";
import type { Arbitrary } from "fast-check";

import { arr, bool, member, num, obj, str, writeCompact } from "./json.js";
import {
  address,
  annotation,
  codeableConcept,
  coding,
  concat,
  contactPoint,
  date,
  dateTime,
  decimalText,
  element,
  exampleConcept,
  extensions,
  fixedConcept,
  humanName,
  identifier,
  instant,
  integerText,
  meta,
  narrative,
  optional,
  period,
  primitiveElement,
  quantity,
  range,
  rangeMembers,
  ratio,
  reference,
  repeated,
  stringValue,
  time,
  token,
  type Members,
  type Shape,
} from "./values.js";

/**
 * The resource types {@link resource} generates: the eight the library's built-in validation
 * models in full.
 */
export const RESOURCE_TYPES = [
  "Patient",
  "Observation",
  "DiagnosticReport",
  "Condition",
  "AllergyIntolerance",
  "MedicationRequest",
  "MedicationStatement",
  "Immunization",
] as const;

/** One of the {@link RESOURCE_TYPES}. */
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/**
 * Generate one of the resource types {@link resource} builds.
 *
 * @returns An arbitrary of the type's name, such as `"Observation"`.
 * @example
 * ```ts
 * import fc from "fast-check";
 * import { resourceType } from "@cosyte/fhir/arbitraries";
 *
 * const [type] = fc.sample(resourceType(), 1);
 * // type is like "Condition"
 * ```
 */
export function resourceType(): Arbitrary<ResourceType> {
  return fc.constantFrom(...RESOURCE_TYPES);
}

/** Options for {@link resource}, {@link resourceJson} and {@link resourceXml}. */
export interface ResourceOptions {
  /** The resource types to draw from. Defaults to all of {@link RESOURCE_TYPES}. */
  readonly types?: readonly ResourceType[];
  /**
   * Whether to add extensions: on elements, and on primitives through their `_` sibling, where a
   * repeating primitive's metadata array lines up with its values by `null`. Defaults to `true`.
   */
  readonly extensions?: boolean;
  /** Whether to add a generated narrative (`text`) to some resources. Defaults to `true`. */
  readonly narrative?: boolean;
  /** The most items in a repeating element. Defaults to 3. */
  readonly maxRepeats?: number;
}

/**
 * The shape options resolve to, with the defaults filled in.
 *
 * @internal
 */
export function shapeOf(options: ResourceOptions): Shape & { readonly narrative: boolean } {
  return {
    extensions: options.extensions ?? true,
    narrative: options.narrative ?? true,
    maxRepeats: options.maxRepeats ?? 3,
  };
}

const LOINC = "http://loinc.org";
const SNOMED = "http://snomed.info/sct";
const TERMINOLOGY = "http://terminology.hl7.org/CodeSystem";

/** A LOINC-shaped code: digits, a hyphen and a check digit, not checked against LOINC. */
function loincCode(): Arbitrary<string> {
  return fc
    .tuple(fc.integer({ min: 100, max: 99999 }), fc.integer({ min: 0, max: 9 }))
    .map(([body, check]) => `${String(body)}-${String(check)}`);
}

/** A SNOMED-shaped concept id, nine digits or more, not checked against SNOMED CT. */
function snomedCode(): Arbitrary<string> {
  return fc.integer({ min: 100000000, max: 999999999 }).map(String);
}

/** A concept in LOINC, SNOMED or `example.org`, with random codes. */
function clinicalConcept(kind: string, shape: Shape): Arbitrary<RawJson> {
  return fc.oneof(
    codeableConcept(coding(fc.constant(LOINC), loincCode(), shape), shape),
    codeableConcept(coding(fc.constant(SNOMED), snomedCode(), shape), shape),
    exampleConcept(kind, shape),
  );
}

/** The members every generated resource opens with: `id`, `meta`, `text` and `extension`. */
function domainResource(shape: Shape & { readonly narrative: boolean }): Arbitrary<Members> {
  return concat(
    optional(element("id", fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9.-]{0,15}$/u).map(str)), 3),
    optional(element("meta", meta(shape)), 4),
    shape.narrative ? optional(element("text", narrative()), 4) : fc.constant([]),
    extensions(shape),
  );
}

/** A required code element, without a `_` sibling that could hide its value. */
function code(name: string, codes: readonly string[]): Arbitrary<Members> {
  return element(name, fc.constantFrom(...codes).map(str));
}

/** A `value[x]` or other choice element: one of the variants, written under its typed name. */
function choice(
  name: string,
  variants: Readonly<Record<string, Arbitrary<RawJson>>>,
): Arbitrary<Members> {
  return fc
    .constantFrom(...Object.keys(variants))
    .chain((type) =>
      (variants[type] as Arbitrary<RawJson>).map((v) => [member(`${name}${type}`, v)]),
    );
}

/** Wrap a resource's members, `resourceType` first. */
function asResource(type: string, members: Arbitrary<Members>): Arbitrary<RawJson> {
  return members.map((ms) => obj([member("resourceType", str(type)), ...ms]));
}

/** A Patient. `pat-1`: a contact names a person, a way to reach them, or an organization. */
function patient(shape: Shape & { readonly narrative: boolean }): Arbitrary<RawJson> {
  const contact = concat(
    optional(repeated("relationship", exampleConcept("relationship", shape), shape), 3),
    element("name", humanName(shape)),
    optional(repeated("telecom", contactPoint(shape), shape)),
  ).map(obj);
  return asResource(
    "Patient",
    concat(
      domainResource(shape),
      optional(repeated("identifier", identifier(shape), shape)),
      optional(primitiveElement("active", fc.boolean().map(bool), shape, { absent: true })),
      optional(repeated("name", humanName(shape), shape)),
      optional(repeated("telecom", contactPoint(shape), shape), 3),
      optional(code("gender", ["male", "female", "other", "unknown"])),
      optional(primitiveElement("birthDate", date().map(str), shape, { absent: true })),
      optional(
        choice("deceased", { Boolean: fc.boolean().map(bool), DateTime: dateTime().map(str) }),
        3,
      ),
      optional(repeated("address", address(shape), shape), 3),
      optional(element("maritalStatus", exampleConcept("marital", shape)), 4),
      optional(
        choice("multipleBirth", {
          Boolean: fc.boolean().map(bool),
          Integer: integerText(1, 9).map(num),
        }),
        4,
      ),
      optional(repeated("contact", contact, shape), 4),
      optional(repeated("generalPractitioner", reference(["Practitioner"], shape), shape), 4),
      optional(element("managingOrganization", reference(["Organization"], shape)), 4),
    ),
  );
}

const OBSERVATION_STATUS = [
  "registered",
  "preliminary",
  "final",
  "amended",
  "corrected",
  "cancelled",
  "entered-in-error",
  "unknown",
] as const;

/** The observation categories other than vital signs, whose units a profile fixes. */
const OBSERVATION_CATEGORIES = [
  "social-history",
  "imaging",
  "laboratory",
  "procedure",
  "survey",
  "exam",
  "therapy",
  "activity",
] as const;

/** Vital signs by LOINC code, each with a unit the vital-signs profile allows. */
const VITAL_SIGNS: readonly (readonly [string, string])[] = [
  ["29463-7", "kg"],
  ["8302-2", "cm"],
  ["8310-5", "Cel"],
  ["8867-4", "/min"],
  ["9279-1", "/min"],
  ["8480-6", "mm[Hg]"],
  ["8462-4", "mm[Hg]"],
  ["59408-5", "%"],
  ["39156-5", "kg/m2"],
];

/** An Observation's `value[x]`. */
function observationValue(shape: Shape): Arbitrary<Members> {
  return choice("value", {
    Quantity: quantity(shape),
    CodeableConcept: exampleConcept("finding", shape),
    String: stringValue({ maxLength: 40 }).map(str),
    Boolean: fc.boolean().map(bool),
    Integer: integerText().map(num),
    Range: range(),
    Ratio: ratio(shape),
    Time: time().map(str),
    DateTime: dateTime().map(str),
    Period: period(),
  });
}

/**
 * An Observation's result: a value, a `dataAbsentReason` with no value (`obs-6`), or neither.
 */
function observationResult(shape: Shape): Arbitrary<Members> {
  return fc.oneof(
    { weight: 4, arbitrary: observationValue(shape) },
    {
      weight: 1,
      arbitrary: element(
        "dataAbsentReason",
        fixedConcept(
          `${TERMINOLOGY}/data-absent-reason`,
          ["unknown", "asked-unknown", "not-asked", "masked", "error", "not-performed"],
          shape,
        ),
      ),
    },
    { weight: 1, arbitrary: fc.constant([]) },
  );
}

/** A lab-style or survey-style Observation, with components coded apart from it (`obs-7`). */
function generalObservation(shape: Shape): Arbitrary<Members> {
  const component = concat(
    element("code", exampleConcept("component", shape)),
    observationResult(shape),
  ).map(obj);
  const referenceRange = fc
    .oneof(
      rangeMembers(),
      stringValue().map((t): Members => [member("text", str(t))]),
    )
    .map(obj);
  return concat(
    optional(
      repeated(
        "category",
        fixedConcept(`${TERMINOLOGY}/observation-category`, OBSERVATION_CATEGORIES, shape),
        shape,
      ),
    ),
    element("code", clinicalConcept("observation", shape)),
    optional(element("subject", reference(["Patient"], shape))),
    optional(element("encounter", reference(["Encounter"], shape)), 4),
    optional(
      choice("effective", {
        DateTime: dateTime().map(str),
        Period: period(),
        Instant: instant().map(str),
      }),
    ),
    optional(primitiveElement("issued", instant().map(str), shape, { absent: true }), 3),
    optional(repeated("performer", reference(["Practitioner", "Organization"], shape), shape), 3),
    observationResult(shape),
    optional(repeated("interpretation", exampleConcept("interpretation", shape), shape), 4),
    optional(repeated("note", annotation(shape), shape), 4),
    optional(element("bodySite", exampleConcept("body-site", shape)), 4),
    optional(element("method", exampleConcept("method", shape)), 4),
    optional(repeated("referenceRange", referenceRange, shape), 4),
    optional(repeated("component", component, shape), 4),
  );
}

/** A vital-signs Observation: a vital-signs LOINC code, and a value in a unit the profile allows. */
function vitalSignObservation(shape: Shape): Arbitrary<Members> {
  return fc.constantFrom(...VITAL_SIGNS).chain(([loinc, unit]) =>
    concat(
      element(
        "category",
        fc.constant(
          arr([
            obj([
              member(
                "coding",
                arr([
                  obj([
                    member("system", str(`${TERMINOLOGY}/observation-category`)),
                    member("code", str("vital-signs")),
                  ]),
                ]),
              ),
            ]),
          ]),
        ),
      ),
      element(
        "code",
        fc.constant(
          obj([
            member(
              "coding",
              arr([obj([member("system", str(LOINC)), member("code", str(loinc))])]),
            ),
          ]),
        ),
      ),
      element("subject", reference(["Patient"], shape)),
      element("effectiveDateTime", dateTime().map(str)),
      optional(
        element(
          "valueQuantity",
          decimalText({ negative: false }).map((v) =>
            obj([
              member("value", num(v)),
              member("unit", str(unit)),
              member("system", str("http://unitsofmeasure.org")),
              member("code", str(unit)),
            ]),
          ),
        ),
        6,
      ),
    ),
  );
}

/** An Observation, general or a vital sign. */
function observation(shape: Shape & { readonly narrative: boolean }): Arbitrary<RawJson> {
  return asResource(
    "Observation",
    concat(
      domainResource(shape),
      optional(repeated("identifier", identifier(shape), shape), 3),
      code("status", OBSERVATION_STATUS),
      fc.oneof(
        { weight: 3, arbitrary: generalObservation(shape) },
        { weight: 1, arbitrary: vitalSignObservation(shape) },
      ),
    ),
  );
}

/** A DiagnosticReport. */
function diagnosticReport(shape: Shape & { readonly narrative: boolean }): Arbitrary<RawJson> {
  return asResource(
    "DiagnosticReport",
    concat(
      domainResource(shape),
      optional(repeated("identifier", identifier(shape), shape), 3),
      code("status", [
        "registered",
        "partial",
        "preliminary",
        "final",
        "amended",
        "corrected",
        "appended",
        "cancelled",
        "entered-in-error",
        "unknown",
      ]),
      optional(repeated("category", exampleConcept("report-category", shape), shape), 3),
      element("code", clinicalConcept("report", shape)),
      optional(element("subject", reference(["Patient"], shape))),
      optional(choice("effective", { DateTime: dateTime().map(str), Period: period() }), 3),
      optional(element("issued", instant().map(str)), 3),
      optional(repeated("performer", reference(["Practitioner", "Organization"], shape), shape), 3),
      optional(repeated("result", reference(["Observation"], shape), shape)),
      optional(primitiveElement("conclusion", stringValue({ maxLength: 40 }).map(str), shape), 3),
      optional(repeated("conclusionCode", exampleConcept("conclusion", shape), shape), 4),
    ),
  );
}

const CONDITION_CLINICAL = `${TERMINOLOGY}/condition-clinical`;
const CONDITION_VERIFICATION = `${TERMINOLOGY}/condition-ver-status`;

/**
 * A Condition. Its statuses keep `con-3`, `con-4` and `con-5`: a clinical status unless the
 * condition was entered in error, none when it was, and an inactive one when it has abated.
 */
function condition(shape: Shape & { readonly narrative: boolean }): Arbitrary<RawJson> {
  const statuses = fc
    .record({
      verification: fc.option(
        fc.constantFrom(
          "unconfirmed",
          "provisional",
          "differential",
          "confirmed",
          "refuted",
          "entered-in-error",
        ),
        { nil: undefined, freq: 3 },
      ),
      abated: fc.boolean(),
    })
    .chain(({ verification, abated }) => {
      const removed = verification === "entered-in-error";
      const clinical = abated
        ? ["inactive", "remission", "resolved"]
        : ["active", "recurrence", "relapse", "inactive", "remission", "resolved"];
      return concat(
        removed
          ? fc.constant([])
          : element("clinicalStatus", fixedConcept(CONDITION_CLINICAL, clinical, shape)),
        verification === undefined
          ? fc.constant([])
          : element(
              "verificationStatus",
              fixedConcept(CONDITION_VERIFICATION, [verification], shape),
            ),
        optional(
          repeated(
            "category",
            fixedConcept(
              `${TERMINOLOGY}/condition-category`,
              ["problem-list-item", "encounter-diagnosis"],
              shape,
            ),
            shape,
          ),
          3,
        ),
        optional(element("severity", exampleConcept("severity", shape)), 4),
        optional(element("code", clinicalConcept("condition", shape)), 4),
        element("subject", reference(["Patient"], shape)),
        optional(
          choice("onset", {
            DateTime: dateTime().map(str),
            Period: period(),
            String: stringValue().map(str),
          }),
          3,
        ),
        abated && !removed
          ? choice("abatement", {
              DateTime: dateTime().map(str),
              Period: period(),
              String: stringValue().map(str),
            })
          : fc.constant([]),
        optional(element("recordedDate", dateTime().map(str)), 3),
        optional(repeated("note", annotation(shape), shape), 4),
      );
    });
  return asResource(
    "Condition",
    concat(
      domainResource(shape),
      optional(repeated("identifier", identifier(shape), shape), 3),
      statuses,
    ),
  );
}

const ALLERGY_CLINICAL = `${TERMINOLOGY}/allergyintolerance-clinical`;
const ALLERGY_VERIFICATION = `${TERMINOLOGY}/allergyintolerance-verification`;

/**
 * An AllergyIntolerance. Its statuses keep `ait-1` and `ait-2`: a clinical status unless the
 * record was entered in error, and none when it was.
 */
function allergyIntolerance(shape: Shape & { readonly narrative: boolean }): Arbitrary<RawJson> {
  const reaction = concat(
    repeated("manifestation", exampleConcept("manifestation", shape), shape),
    optional(code("severity", ["mild", "moderate", "severe"]), 3),
  ).map(obj);
  const statuses = fc
    .option(fc.constantFrom("unconfirmed", "confirmed", "refuted", "entered-in-error"), {
      nil: undefined,
      freq: 3,
    })
    .chain((verification) =>
      concat(
        verification === "entered-in-error"
          ? fc.constant([])
          : element(
              "clinicalStatus",
              fixedConcept(
                ALLERGY_CLINICAL,
                verification === "refuted"
                  ? ["inactive", "resolved"]
                  : ["active", "inactive", "resolved"],
                shape,
              ),
            ),
        verification === undefined
          ? fc.constant([])
          : element(
              "verificationStatus",
              fixedConcept(ALLERGY_VERIFICATION, [verification], shape),
            ),
      ),
    );
  return asResource(
    "AllergyIntolerance",
    concat(
      domainResource(shape),
      optional(repeated("identifier", identifier(shape), shape), 3),
      statuses,
      optional(code("type", ["allergy", "intolerance"]), 3),
      optional(
        fc
          .uniqueArray(fc.constantFrom("food", "medication", "environment", "biologic"), {
            minLength: 1,
            maxLength: 2,
          })
          .map((cats): Members => [member("category", arr(cats.map(str)))]),
        3,
      ),
      optional(code("criticality", ["low", "high", "unable-to-assess"]), 3),
      optional(element("code", exampleConcept("substance", shape)), 4),
      element("patient", reference(["Patient"], shape)),
      optional(
        choice("onset", {
          DateTime: dateTime().map(str),
          Period: period(),
          String: stringValue().map(str),
        }),
        3,
      ),
      optional(element("recordedDate", dateTime().map(str)), 3),
      optional(repeated("note", annotation(shape), shape), 4),
      optional(repeated("reaction", reaction, shape), 3),
    ),
  );
}

/** A medication: a concept, or a reference to a Medication. */
function medication(shape: Shape): Arbitrary<Members> {
  return choice("medication", {
    CodeableConcept: exampleConcept("medication", shape),
    Reference: reference(["Medication"], shape),
  });
}

/** A `Dosage`: text, timing words, and sometimes a dose quantity. */
function dosage(shape: Shape): Arbitrary<RawJson> {
  const dose = quantity(shape, decimalText({ negative: false, exponent: false })).map((q) =>
    obj([member("doseQuantity", q)]),
  );
  return concat(
    optional(element("sequence", integerText(1, 9).map(num)), 3),
    primitiveElement("text", stringValue({ maxLength: 30 }).map(str), shape),
    optional(repeated("doseAndRate", dose, { ...shape, maxRepeats: 1 }), 2),
  ).map(obj);
}

/** A MedicationRequest. */
function medicationRequest(shape: Shape & { readonly narrative: boolean }): Arbitrary<RawJson> {
  return asResource(
    "MedicationRequest",
    concat(
      domainResource(shape),
      optional(repeated("identifier", identifier(shape), shape), 3),
      code("status", [
        "active",
        "on-hold",
        "cancelled",
        "completed",
        "entered-in-error",
        "stopped",
        "draft",
        "unknown",
      ]),
      code("intent", [
        "proposal",
        "plan",
        "order",
        "original-order",
        "reflex-order",
        "filler-order",
        "instance-order",
        "option",
      ]),
      optional(code("priority", ["routine", "urgent", "asap", "stat"]), 3),
      optional(element("doNotPerform", fc.boolean().map(bool)), 4),
      medication(shape),
      element("subject", reference(["Patient"], shape)),
      optional(element("authoredOn", dateTime().map(str)), 3),
      optional(element("requester", reference(["Practitioner"], shape)), 3),
      optional(repeated("reasonCode", exampleConcept("reason", shape), shape), 4),
      optional(repeated("note", annotation(shape), shape), 4),
      optional(repeated("dosageInstruction", dosage(shape), shape), 3),
    ),
  );
}

/** A MedicationStatement. */
function medicationStatement(shape: Shape & { readonly narrative: boolean }): Arbitrary<RawJson> {
  return asResource(
    "MedicationStatement",
    concat(
      domainResource(shape),
      optional(repeated("identifier", identifier(shape), shape), 3),
      code("status", [
        "active",
        "completed",
        "entered-in-error",
        "intended",
        "stopped",
        "on-hold",
        "unknown",
        "not-taken",
      ]),
      optional(repeated("statusReason", exampleConcept("status-reason", shape), shape), 4),
      medication(shape),
      element("subject", reference(["Patient"], shape)),
      optional(choice("effective", { DateTime: dateTime().map(str), Period: period() }), 3),
      optional(element("dateAsserted", dateTime().map(str)), 3),
      optional(repeated("note", annotation(shape), shape), 4),
      optional(repeated("dosage", dosage(shape), shape), 3),
    ),
  );
}

/** An Immunization. */
function immunization(shape: Shape & { readonly narrative: boolean }): Arbitrary<RawJson> {
  return asResource(
    "Immunization",
    concat(
      domainResource(shape),
      optional(repeated("identifier", identifier(shape), shape), 3),
      code("status", ["completed", "entered-in-error", "not-done"]),
      optional(element("statusReason", exampleConcept("status-reason", shape)), 4),
      element(
        "vaccineCode",
        codeableConcept(
          coding(
            fc.constant("http://hl7.org/fhir/sid/cvx"),
            integerText(1, 300).map(String),
            shape,
          ),
          shape,
        ),
      ),
      element("patient", reference(["Patient"], shape)),
      choice("occurrence", { DateTime: dateTime().map(str), String: stringValue().map(str) }),
      optional(element("primarySource", fc.boolean().map(bool)), 3),
      optional(primitiveElement("lotNumber", token(10).map(str), shape), 3),
      optional(element("expirationDate", date().map(str)), 4),
      optional(element("site", exampleConcept("site", shape)), 4),
      optional(element("route", exampleConcept("route", shape)), 4),
      optional(
        element("doseQuantity", quantity(shape, decimalText({ negative: false, exponent: false }))),
        4,
      ),
      optional(repeated("note", annotation(shape), shape), 4),
    ),
  );
}

/** The builder of each resource type. */
const BUILDERS: Readonly<
  Record<ResourceType, (shape: Shape & { readonly narrative: boolean }) => Arbitrary<RawJson>>
> = {
  Patient: patient,
  Observation: observation,
  DiagnosticReport: diagnosticReport,
  Condition: condition,
  AllergyIntolerance: allergyIntolerance,
  MedicationRequest: medicationRequest,
  MedicationStatement: medicationStatement,
  Immunization: immunization,
};

/**
 * Generate a resource as a raw JSON tree.
 *
 * @internal
 */
export function resourceTree(options: ResourceOptions = {}): Arbitrary<RawJson> {
  const shape = shapeOf(options);
  const types =
    options.types !== undefined && options.types.length > 0 ? options.types : RESOURCE_TYPES;
  return fc.constantFrom(...types).chain((type) => BUILDERS[type](shape));
}

/**
 * The spec-clean JSON text {@link resource} parses, written apart from the library's writer.
 *
 * @internal
 */
export function cleanResourceJson(options: ResourceOptions = {}): Arbitrary<string> {
  return resourceTree(options).map(writeCompact);
}

/**
 * Parse generated text into a resource fast-check can print and clone: printed, a failing resource
 * reads as the `parseResource(...)` call that rebuilds it; cloned, it is parsed again, so code under
 * test that changes a resource cannot change the case fast-check replays.
 *
 * @internal
 */
export function parsedResource(text: string): FhirComplex {
  const { resource: model } = parseResource(text);
  Object.defineProperty(model, fc.toStringMethod, {
    value: () => `parseResource(${JSON.stringify(text)}).resource`,
  });
  Object.defineProperty(model, fc.cloneMethod, { value: () => parsedResource(text) });
  return model;
}

/**
 * Generate a spec-clean resource, parsed: one of the eight types the library validates in full,
 * with every element it requires, codes from its required bindings, and statuses that keep the
 * invariants (`con-3` to `con-5`, `ait-1` and `ait-2`, `obs-6` and `obs-7`, `pat-1`, `ext-1`), so
 * it validates with no error, strict mode included. Values are biased toward what a codec gets
 * wrong: decimals with trailing zeros, more digits than a double holds and exponents, strings with
 * characters JSON and XML escape, extensions on primitives with `null`-aligned metadata arrays, and
 * a narrative. Every value is random. Each case is a new model, so the code under test may change
 * it.
 *
 * @param options The resource types, extensions, narrative and list sizes.
 * @returns An arbitrary of the resource model.
 * @example
 * ```ts
 * import fc from "fast-check";
 * import { parseResource, serializeResource } from "@cosyte/fhir";
 * import { resource } from "@cosyte/fhir/arbitraries";
 *
 * fc.assert(
 *   fc.property(resource(), (model) => {
 *     const text = serializeResource(model);
 *     return serializeResource(parseResource(text).resource) === text;
 *   }),
 * );
 * ```
 */
export function resource(options: ResourceOptions = {}): Arbitrary<FhirComplex> {
  return cleanResourceJson(options).map(parsedResource);
}

/** Options for {@link bundle}. */
export interface BundleOptions extends ResourceOptions {
  /** The most entries. Defaults to 4. */
  readonly maxEntries?: number;
}

/**
 * The spec-clean JSON text {@link bundle} parses.
 *
 * @internal
 */
export function cleanBundleJson(options: BundleOptions = {}): Arbitrary<string> {
  const entry = fc.tuple(fc.uuid(), resourceTree(options));
  return fc
    .record({
      type: fc.constantFrom("collection", "searchset"),
      id: fc.option(token(12), { nil: undefined }),
      timestamp: fc.option(instant(), { nil: undefined }),
      entries: fc.uniqueArray(entry, {
        maxLength: options.maxEntries ?? 4,
        selector: ([id]) => id,
      }),
    })
    .map(({ type, id, timestamp, entries }) => {
      const members: RawMember[] = [member("resourceType", str("Bundle"))];
      if (id !== undefined) members.push(member("id", str(id)));
      members.push(member("type", str(type)));
      if (timestamp !== undefined) members.push(member("timestamp", str(timestamp)));
      if (type === "searchset") members.push(member("total", num(String(entries.length))));
      const items = entries.map(([uuid, r]) =>
        obj([member("fullUrl", str(`urn:uuid:${uuid}`)), member("resource", r)]),
      );
      if (items.length > 0) members.push(member("entry", arr(items)));
      return writeCompact(obj(members));
    });
}

/**
 * Generate a spec-clean Bundle, parsed: a collection or a search set of resources from
 * {@link resource}, each with a unique `urn:uuid` full URL.
 *
 * @param options The resource options, and the most entries.
 * @returns An arbitrary of the Bundle model.
 * @example
 * ```ts
 * import fc from "fast-check";
 * import { readBundle } from "@cosyte/fhir";
 * import { bundle } from "@cosyte/fhir/arbitraries";
 *
 * fc.assert(fc.property(bundle(), (b) => readBundle(b).entries.length <= 4));
 * ```
 */
export function bundle(options: BundleOptions = {}): Arbitrary<FhirComplex> {
  return cleanBundleJson(options).map(parsedResource);
}
