/**
 * The compact element schema the validator walks, a **non-StructureDefinition** description
 * of a resource's direct elements: cardinality, datatype(s), and any required-strength code binding.
 *
 * This is deliberately *not* a FHIR `StructureDefinition` and not a snapshot generator, that engine
 * (loading StructureDefinitions, generating snapshots from differentials, slicing, US Core profiles)
 * is separate ({@link ../profiles/index.js}). This layer needs only enough shape to run layers 1–3,
 * so it uses a hand-authored, hierarchy-free record; the schema type is the seam between the two.
 *
 * **What ships built-in here is a named, deliberately short list:** the base `Resource` /
 * `DomainResource` elements (which are the same on every resource), plus one element table per
 * modeled resource type. Read the enumeration off {@link BUILTIN_SCHEMAS} and never off a sentence
 * here: it is `Patient` plus the resource types this library treats as safety-critical, and a
 * written-down list in prose is the thing that goes stale. Every other resource type is
 * "not modeled yet" and degrades safely (see {@link ./validate.js}) rather than emitting false
 * errors, which is why the set grows one fully-verified table at a time: a table missing a row R4
 * defines turns a conformant document into an unknown-element finding, so a half-entered type would
 * be worse than no entry at all. Cardinalities are cited from the R4 4.0.1 base definitions
 * (resource.html, domainresource.html, patient.html, observation.html, allergyintolerance.html,
 * condition.html, diagnosticreport.html, immunization.html, medicationrequest.html,
 * medicationstatement.html).
 *
 * **Only a `required`-strength binding on a `code`-typed element is carried here**, because that is
 * the only one this layer can decide from an enumeration alone. A `required` binding on a
 * `CodeableConcept` (`Condition.clinicalStatus` and `AllergyIntolerance.verificationStatus` among
 * them) is a membership question about a `Coding` inside a complex datatype, which belongs to the
 * terminology layer; the element is carried with its cardinality and datatype and its binding is
 * left alone. Weaker strengths (`extensible`, `preferred`, `example`) are that layer's too.
 *
 * @packageDocumentation
 */

/** `1..1` / `0..*` etc. `max` uses {@link UNBOUNDED} for `*`. */
export const UNBOUNDED = Number.POSITIVE_INFINITY;

/** The definition of one direct element of a resource. */
export interface ElementSchema {
  /** Minimum cardinality (`0` for optional, `≥ 1` for required). */
  readonly min: number;
  /** Maximum cardinality (`1` for a singleton, {@link UNBOUNDED} for `*`). */
  readonly max: number;
  /**
   * The allowed datatype name(s). One entry for a normal element; several for a `choice[x]` element
   * (see {@link isChoice}). Primitive names are validated by {@link ./primitives.js}; complex names
   * (e.g. `HumanName`) are validated structurally (cardinality + node shape) only, their internals
   * need the datatype's own definition, which this schema does not carry.
   */
  readonly types: readonly string[];
  /** A required-strength enumerated `code` binding, when the element has one. */
  readonly binding?: RequiredBinding;
}

/** A required-strength value-set binding to a fixed set of `code` values. */
export interface RequiredBinding {
  /** Only `"required"` bindings are enforced here; weaker strengths are the terminology layer's. */
  readonly strength: "required";
  /** The complete enumerated code set. */
  readonly codes: readonly string[];
}

/** A resource's direct elements, keyed by element name (the `choice[x]` base for choices). */
export interface ResourceSchema {
  /** The resource type this schema describes (e.g. `"Patient"`). */
  readonly type: string;
  /** Direct elements by name. The base-resource elements are merged in by the registry. */
  readonly elements: Readonly<Record<string, ElementSchema>>;
}

/**
 * Whether an element is a `choice[x]` (more than one allowed datatype).
 *
 * @param element - An element schema.
 * @returns `true` when the element allows more than one datatype.
 * @example
 * ```ts
 * import { isChoice } from "@cosyte/fhir";
 * isChoice({ min: 0, max: 1, types: ["boolean", "dateTime"] }); // true
 * ```
 */
export function isChoice(element: ElementSchema): boolean {
  return element.types.length > 1;
}

/**
 * The direct elements shared by every resource: `Resource` (`id`, `meta`, `implicitRules`,
 * `language`) plus `DomainResource` (`text`, `contained`, `extension`, `modifierExtension`). All are
 * optional in the base definitions. `language` binds to CommonLanguages at *preferred* strength in
 * R4, **not** required, so it is not enumerated here.
 * *(resource.html, domainresource.html)*
 */
const BASE_ELEMENTS: Readonly<Record<string, ElementSchema>> = {
  id: { min: 0, max: 1, types: ["id"] },
  meta: { min: 0, max: 1, types: ["Meta"] },
  implicitRules: { min: 0, max: 1, types: ["uri"] },
  language: { min: 0, max: 1, types: ["code"] },
  text: { min: 0, max: 1, types: ["Narrative"] },
  contained: { min: 0, max: UNBOUNDED, types: ["Resource"] },
  extension: { min: 0, max: UNBOUNDED, types: ["Extension"] },
  modifierExtension: { min: 0, max: UNBOUNDED, types: ["Extension"] },
};

/** R4 `AdministrativeGender`, the required binding on `Patient.gender`. *(patient.html)* */
const ADMINISTRATIVE_GENDER = ["male", "female", "other", "unknown"] as const;

/**
 * `Patient` direct elements, from the R4 base StructureDefinition (patient.html). All are optional in
 * base R4 (Patient has no mandatory direct element). `gender` carries the one required binding.
 * `deceased[x]` and `multipleBirth[x]` are `choice[x]` elements. Complex-typed elements are checked
 * for cardinality and node shape only.
 */
const PATIENT_ELEMENTS: Readonly<Record<string, ElementSchema>> = {
  identifier: { min: 0, max: UNBOUNDED, types: ["Identifier"] },
  active: { min: 0, max: 1, types: ["boolean"] },
  name: { min: 0, max: UNBOUNDED, types: ["HumanName"] },
  telecom: { min: 0, max: UNBOUNDED, types: ["ContactPoint"] },
  gender: {
    min: 0,
    max: 1,
    types: ["code"],
    binding: { strength: "required", codes: [...ADMINISTRATIVE_GENDER] },
  },
  birthDate: { min: 0, max: 1, types: ["date"] },
  deceased: { min: 0, max: 1, types: ["boolean", "dateTime"] },
  address: { min: 0, max: UNBOUNDED, types: ["Address"] },
  maritalStatus: { min: 0, max: 1, types: ["CodeableConcept"] },
  multipleBirth: { min: 0, max: 1, types: ["boolean", "integer"] },
  photo: { min: 0, max: UNBOUNDED, types: ["Attachment"] },
  contact: { min: 0, max: UNBOUNDED, types: ["BackboneElement"] },
  communication: { min: 0, max: UNBOUNDED, types: ["BackboneElement"] },
  generalPractitioner: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  managingOrganization: { min: 0, max: 1, types: ["Reference"] },
  link: { min: 0, max: UNBOUNDED, types: ["BackboneElement"] },
};

/**
 * R4 `ObservationStatus`, the required binding on `Observation.status`, in the order the published
 * expansion lists them. The value set contains exactly these eight concepts, all from
 * `http://hl7.org/fhir/observation-status` at version 4.0.1; `corrected` is drawn one level under
 * `amended` there, but the hierarchy is presentational and all eight are members.
 * *(valueset-observation-status.html)*
 */
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

/**
 * `Observation` direct elements, from the R4 4.0.1 base StructureDefinition (observation.html).
 * `status` and `code` are the only two mandatory ones; `status` carries the one required-strength
 * binding. `effective[x]` and `value[x]` are `choice[x]` elements (four and eleven variants).
 *
 * `component` and `referenceRange` are backbone elements and are modeled the way `Patient.contact`
 * and `Patient.link` are: cardinality and node shape only. Their children, `component.value[x]`
 * included, are deliberately left unmodeled here, so nothing inside one is checked and nothing
 * inside one can draw a finding from this layer.
 *
 * The weaker bindings this type carries are deliberately absent: `category` (preferred), `code` and
 * `bodySite` and `method` (example), `interpretation` and `dataAbsentReason` (extensible). This
 * layer enforces `required` strength only, and severity by strength belongs to the terminology
 * layer. The two FHIRPath invariants on this type (a data-absent reason beside a value, and a
 * component code repeating the observation's own) are the profile/invariant layer's, not this one's.
 */
const OBSERVATION_ELEMENTS: Readonly<Record<string, ElementSchema>> = {
  identifier: { min: 0, max: UNBOUNDED, types: ["Identifier"] },
  basedOn: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  partOf: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  status: {
    min: 1,
    max: 1,
    types: ["code"],
    binding: { strength: "required", codes: [...OBSERVATION_STATUS] },
  },
  category: { min: 0, max: UNBOUNDED, types: ["CodeableConcept"] },
  code: { min: 1, max: 1, types: ["CodeableConcept"] },
  subject: { min: 0, max: 1, types: ["Reference"] },
  focus: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  encounter: { min: 0, max: 1, types: ["Reference"] },
  effective: { min: 0, max: 1, types: ["dateTime", "Period", "Timing", "instant"] },
  issued: { min: 0, max: 1, types: ["instant"] },
  performer: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  value: {
    min: 0,
    max: 1,
    types: [
      "Quantity",
      "CodeableConcept",
      "string",
      "boolean",
      "integer",
      "Range",
      "Ratio",
      "SampledData",
      "time",
      "dateTime",
      "Period",
    ],
  },
  dataAbsentReason: { min: 0, max: 1, types: ["CodeableConcept"] },
  interpretation: { min: 0, max: UNBOUNDED, types: ["CodeableConcept"] },
  note: { min: 0, max: UNBOUNDED, types: ["Annotation"] },
  bodySite: { min: 0, max: 1, types: ["CodeableConcept"] },
  method: { min: 0, max: 1, types: ["CodeableConcept"] },
  specimen: { min: 0, max: 1, types: ["Reference"] },
  device: { min: 0, max: 1, types: ["Reference"] },
  referenceRange: { min: 0, max: UNBOUNDED, types: ["BackboneElement"] },
  hasMember: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  derivedFrom: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  component: { min: 0, max: UNBOUNDED, types: ["BackboneElement"] },
};

/**
 * R4 `DiagnosticReportStatus`, the required binding on `DiagnosticReport.status`, in the order the
 * published code system lists them. `partial` and `final` are drawn as parents of `preliminary` /
 * `amended` / `appended` there, but the hierarchy is presentational and all ten are members.
 * *(valueset-diagnostic-report-status.html)*
 */
const DIAGNOSTIC_REPORT_STATUS = [
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
] as const;

/**
 * `DiagnosticReport` direct elements, from the R4 4.0.1 base StructureDefinition
 * (diagnosticreport.html). `status` and `code` are the only two mandatory ones; `status` carries the
 * one required-strength binding this layer enforces. `effective[x]` is a two-variant choice.
 *
 * `media` is a backbone element and is modeled the way `Observation.component` is: cardinality and
 * node shape only, its children deliberately unentered. `code` (preferred), `category` and
 * `conclusionCode` (example) are the terminology layer's.
 */
const DIAGNOSTIC_REPORT_ELEMENTS: Readonly<Record<string, ElementSchema>> = {
  identifier: { min: 0, max: UNBOUNDED, types: ["Identifier"] },
  basedOn: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  status: {
    min: 1,
    max: 1,
    types: ["code"],
    binding: { strength: "required", codes: [...DIAGNOSTIC_REPORT_STATUS] },
  },
  category: { min: 0, max: UNBOUNDED, types: ["CodeableConcept"] },
  code: { min: 1, max: 1, types: ["CodeableConcept"] },
  subject: { min: 0, max: 1, types: ["Reference"] },
  encounter: { min: 0, max: 1, types: ["Reference"] },
  effective: { min: 0, max: 1, types: ["dateTime", "Period"] },
  issued: { min: 0, max: 1, types: ["instant"] },
  performer: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  resultsInterpreter: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  specimen: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  result: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  imagingStudy: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  media: { min: 0, max: UNBOUNDED, types: ["BackboneElement"] },
  conclusion: { min: 0, max: 1, types: ["string"] },
  conclusionCode: { min: 0, max: UNBOUNDED, types: ["CodeableConcept"] },
  presentedForm: { min: 0, max: UNBOUNDED, types: ["Attachment"] },
};

/**
 * `Condition` direct elements, from the R4 4.0.1 base StructureDefinition (condition.html).
 * `subject` is the one mandatory direct element, and this type carries NO required-strength binding
 * this layer can enforce: `clinicalStatus` and `verificationStatus` are `required` in R4 but
 * `CodeableConcept`-valued, so their membership is the terminology layer's question and their
 * binding is deliberately absent here (see the module doc).
 *
 * `onset[x]` and `abatement[x]` are five-variant choices. `stage` and `evidence` are backbone
 * elements, modeled for cardinality and node shape only.
 */
const CONDITION_ELEMENTS: Readonly<Record<string, ElementSchema>> = {
  identifier: { min: 0, max: UNBOUNDED, types: ["Identifier"] },
  clinicalStatus: { min: 0, max: 1, types: ["CodeableConcept"] },
  verificationStatus: { min: 0, max: 1, types: ["CodeableConcept"] },
  category: { min: 0, max: UNBOUNDED, types: ["CodeableConcept"] },
  severity: { min: 0, max: 1, types: ["CodeableConcept"] },
  code: { min: 0, max: 1, types: ["CodeableConcept"] },
  bodySite: { min: 0, max: UNBOUNDED, types: ["CodeableConcept"] },
  subject: { min: 1, max: 1, types: ["Reference"] },
  encounter: { min: 0, max: 1, types: ["Reference"] },
  onset: { min: 0, max: 1, types: ["dateTime", "Age", "Period", "Range", "string"] },
  abatement: { min: 0, max: 1, types: ["dateTime", "Age", "Period", "Range", "string"] },
  recordedDate: { min: 0, max: 1, types: ["dateTime"] },
  recorder: { min: 0, max: 1, types: ["Reference"] },
  asserter: { min: 0, max: 1, types: ["Reference"] },
  stage: { min: 0, max: UNBOUNDED, types: ["BackboneElement"] },
  evidence: { min: 0, max: UNBOUNDED, types: ["BackboneElement"] },
  note: { min: 0, max: UNBOUNDED, types: ["Annotation"] },
};

/**
 * R4 `medicationrequest Status`, the required binding on `MedicationRequest.status`, in the order
 * the published code system lists them. *(valueset-medicationrequest-status.html)*
 */
const MEDICATION_REQUEST_STATUS = [
  "active",
  "on-hold",
  "cancelled",
  "completed",
  "entered-in-error",
  "stopped",
  "draft",
  "unknown",
] as const;

/**
 * R4 `medicationRequest Intent`, the required binding on `MedicationRequest.intent`, in the order
 * the published code system lists them. *(valueset-medicationrequest-intent.html)*
 */
const MEDICATION_REQUEST_INTENT = [
  "proposal",
  "plan",
  "order",
  "original-order",
  "reflex-order",
  "filler-order",
  "instance-order",
  "option",
] as const;

/**
 * R4 `RequestPriority`, the required binding on `MedicationRequest.priority`.
 * *(valueset-request-priority.html)*
 */
const REQUEST_PRIORITY = ["routine", "urgent", "asap", "stat"] as const;

/**
 * `MedicationRequest` direct elements, from the R4 4.0.1 base StructureDefinition
 * (medicationrequest.html). `status`, `intent`, `medication[x]` and `subject` are the four mandatory
 * ones, and `status`, `intent` and `priority` are the three `code`-typed required bindings.
 *
 * `medication[x]` carries an `example`-strength binding in R4 and is a `CodeableConcept | Reference`
 * choice, so no enumeration is enforced on it here. `reported[x]` is the other choice.
 * `dispenseRequest` and `substitution` are backbone elements, modeled for cardinality and node shape
 * only, so nothing inside a `dispenseRequest.quantity` is entered from this layer.
 */
const MEDICATION_REQUEST_ELEMENTS: Readonly<Record<string, ElementSchema>> = {
  identifier: { min: 0, max: UNBOUNDED, types: ["Identifier"] },
  status: {
    min: 1,
    max: 1,
    types: ["code"],
    binding: { strength: "required", codes: [...MEDICATION_REQUEST_STATUS] },
  },
  statusReason: { min: 0, max: 1, types: ["CodeableConcept"] },
  intent: {
    min: 1,
    max: 1,
    types: ["code"],
    binding: { strength: "required", codes: [...MEDICATION_REQUEST_INTENT] },
  },
  category: { min: 0, max: UNBOUNDED, types: ["CodeableConcept"] },
  priority: {
    min: 0,
    max: 1,
    types: ["code"],
    binding: { strength: "required", codes: [...REQUEST_PRIORITY] },
  },
  doNotPerform: { min: 0, max: 1, types: ["boolean"] },
  reported: { min: 0, max: 1, types: ["boolean", "Reference"] },
  medication: { min: 1, max: 1, types: ["CodeableConcept", "Reference"] },
  subject: { min: 1, max: 1, types: ["Reference"] },
  encounter: { min: 0, max: 1, types: ["Reference"] },
  supportingInformation: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  authoredOn: { min: 0, max: 1, types: ["dateTime"] },
  requester: { min: 0, max: 1, types: ["Reference"] },
  performer: { min: 0, max: 1, types: ["Reference"] },
  performerType: { min: 0, max: 1, types: ["CodeableConcept"] },
  recorder: { min: 0, max: 1, types: ["Reference"] },
  reasonCode: { min: 0, max: UNBOUNDED, types: ["CodeableConcept"] },
  reasonReference: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  instantiatesCanonical: { min: 0, max: UNBOUNDED, types: ["canonical"] },
  instantiatesUri: { min: 0, max: UNBOUNDED, types: ["uri"] },
  basedOn: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  groupIdentifier: { min: 0, max: 1, types: ["Identifier"] },
  courseOfTherapyType: { min: 0, max: 1, types: ["CodeableConcept"] },
  insurance: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  note: { min: 0, max: UNBOUNDED, types: ["Annotation"] },
  dosageInstruction: { min: 0, max: UNBOUNDED, types: ["Dosage"] },
  dispenseRequest: { min: 0, max: 1, types: ["BackboneElement"] },
  substitution: { min: 0, max: 1, types: ["BackboneElement"] },
  priorPrescription: { min: 0, max: 1, types: ["Reference"] },
  detectedIssue: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  eventHistory: { min: 0, max: UNBOUNDED, types: ["Reference"] },
};

/** R4 `AllergyIntoleranceType`, the required binding on `AllergyIntolerance.type`. */
const ALLERGY_INTOLERANCE_TYPE = ["allergy", "intolerance"] as const;

/** R4 `AllergyIntoleranceCategory`, the required binding on `AllergyIntolerance.category`. */
const ALLERGY_INTOLERANCE_CATEGORY = ["food", "medication", "environment", "biologic"] as const;

/** R4 `AllergyIntoleranceCriticality`, the required binding on `AllergyIntolerance.criticality`. */
const ALLERGY_INTOLERANCE_CRITICALITY = ["low", "high", "unable-to-assess"] as const;

/**
 * `AllergyIntolerance` direct elements, from the R4 4.0.1 base StructureDefinition
 * (allergyintolerance.html). `patient` is the one mandatory direct element. Three `code`-typed
 * elements carry required bindings: `type`, `category` (which is `0..*`, so the binding is checked
 * per occurrence) and `criticality`.
 *
 * `clinicalStatus` and `verificationStatus` are `required` in R4 too and are deliberately carried
 * WITHOUT a binding here, because they are `CodeableConcept`-valued (see the module doc). `reaction`
 * is a backbone element, modeled for cardinality and node shape only, so `reaction.manifestation`
 * being `1..*` in R4 is not entered from this layer.
 */
const ALLERGY_INTOLERANCE_ELEMENTS: Readonly<Record<string, ElementSchema>> = {
  identifier: { min: 0, max: UNBOUNDED, types: ["Identifier"] },
  clinicalStatus: { min: 0, max: 1, types: ["CodeableConcept"] },
  verificationStatus: { min: 0, max: 1, types: ["CodeableConcept"] },
  type: {
    min: 0,
    max: 1,
    types: ["code"],
    binding: { strength: "required", codes: [...ALLERGY_INTOLERANCE_TYPE] },
  },
  category: {
    min: 0,
    max: UNBOUNDED,
    types: ["code"],
    binding: { strength: "required", codes: [...ALLERGY_INTOLERANCE_CATEGORY] },
  },
  criticality: {
    min: 0,
    max: 1,
    types: ["code"],
    binding: { strength: "required", codes: [...ALLERGY_INTOLERANCE_CRITICALITY] },
  },
  code: { min: 0, max: 1, types: ["CodeableConcept"] },
  patient: { min: 1, max: 1, types: ["Reference"] },
  encounter: { min: 0, max: 1, types: ["Reference"] },
  onset: { min: 0, max: 1, types: ["dateTime", "Age", "Period", "Range", "string"] },
  recordedDate: { min: 0, max: 1, types: ["dateTime"] },
  recorder: { min: 0, max: 1, types: ["Reference"] },
  asserter: { min: 0, max: 1, types: ["Reference"] },
  lastOccurrence: { min: 0, max: 1, types: ["dateTime"] },
  note: { min: 0, max: UNBOUNDED, types: ["Annotation"] },
  reaction: { min: 0, max: UNBOUNDED, types: ["BackboneElement"] },
};

/**
 * R4 `ImmunizationStatusCodes`, the required binding on `Immunization.status`. This value set is the
 * one of the nine here whose R4 definition ENUMERATES three concepts out of a larger code system
 * (`event-status`, which holds eight) rather than including the system whole, so the enumeration
 * below is the value set's own three and not the code system's eight.
 * *(valueset-immunization-status.html)*
 */
const IMMUNIZATION_STATUS = ["completed", "entered-in-error", "not-done"] as const;

/**
 * `Immunization` direct elements, from the R4 4.0.1 base StructureDefinition (immunization.html).
 * `status`, `vaccineCode`, `patient` and `occurrence[x]` are the four mandatory ones; `status`
 * carries the one required-strength binding. `occurrence[x]` is a `dateTime | string` choice and is
 * mandatory, so a document writing neither variant draws a cardinality finding at `occurrence[x]`.
 *
 * `performer`, `education`, `reaction` and `protocolApplied` are backbone elements, modeled for
 * cardinality and node shape only.
 */
const IMMUNIZATION_ELEMENTS: Readonly<Record<string, ElementSchema>> = {
  identifier: { min: 0, max: UNBOUNDED, types: ["Identifier"] },
  status: {
    min: 1,
    max: 1,
    types: ["code"],
    binding: { strength: "required", codes: [...IMMUNIZATION_STATUS] },
  },
  statusReason: { min: 0, max: 1, types: ["CodeableConcept"] },
  vaccineCode: { min: 1, max: 1, types: ["CodeableConcept"] },
  patient: { min: 1, max: 1, types: ["Reference"] },
  encounter: { min: 0, max: 1, types: ["Reference"] },
  occurrence: { min: 1, max: 1, types: ["dateTime", "string"] },
  recorded: { min: 0, max: 1, types: ["dateTime"] },
  primarySource: { min: 0, max: 1, types: ["boolean"] },
  reportOrigin: { min: 0, max: 1, types: ["CodeableConcept"] },
  location: { min: 0, max: 1, types: ["Reference"] },
  manufacturer: { min: 0, max: 1, types: ["Reference"] },
  lotNumber: { min: 0, max: 1, types: ["string"] },
  expirationDate: { min: 0, max: 1, types: ["date"] },
  site: { min: 0, max: 1, types: ["CodeableConcept"] },
  route: { min: 0, max: 1, types: ["CodeableConcept"] },
  doseQuantity: { min: 0, max: 1, types: ["Quantity"] },
  performer: { min: 0, max: UNBOUNDED, types: ["BackboneElement"] },
  note: { min: 0, max: UNBOUNDED, types: ["Annotation"] },
  reasonCode: { min: 0, max: UNBOUNDED, types: ["CodeableConcept"] },
  reasonReference: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  isSubpotent: { min: 0, max: 1, types: ["boolean"] },
  subpotentReason: { min: 0, max: UNBOUNDED, types: ["CodeableConcept"] },
  education: { min: 0, max: UNBOUNDED, types: ["BackboneElement"] },
  programEligibility: { min: 0, max: UNBOUNDED, types: ["CodeableConcept"] },
  fundingSource: { min: 0, max: 1, types: ["CodeableConcept"] },
  reaction: { min: 0, max: UNBOUNDED, types: ["BackboneElement"] },
  protocolApplied: { min: 0, max: UNBOUNDED, types: ["BackboneElement"] },
};

/**
 * R4 `Medication Status Codes`, the required binding on `MedicationStatement.status`, in the order
 * the published code system lists them. `not-taken` is a member of this set and is one of the
 * negations the safety layer reads, so a table that dropped it would turn a recorded refusal into a
 * binding error. *(valueset-medication-statement-status.html)*
 */
const MEDICATION_STATEMENT_STATUS = [
  "active",
  "completed",
  "entered-in-error",
  "intended",
  "stopped",
  "on-hold",
  "unknown",
  "not-taken",
] as const;

/**
 * `MedicationStatement` direct elements, from the R4 4.0.1 base StructureDefinition
 * (medicationstatement.html). `status`, `medication[x]` and `subject` are the three mandatory ones;
 * `status` carries the one required-strength binding. `effective[x]` is a `dateTime | Period` choice
 * and `medication[x]` a `CodeableConcept | Reference` one.
 *
 * Note the two cardinalities that differ from the same-named elements on `MedicationRequest`:
 * `statusReason` is `0..*` here and `0..1` there, and `category` is `0..1` here and `0..*` there.
 * This type has no backbone element of its own; `dosage` is the `Dosage` datatype.
 */
const MEDICATION_STATEMENT_ELEMENTS: Readonly<Record<string, ElementSchema>> = {
  identifier: { min: 0, max: UNBOUNDED, types: ["Identifier"] },
  basedOn: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  partOf: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  status: {
    min: 1,
    max: 1,
    types: ["code"],
    binding: { strength: "required", codes: [...MEDICATION_STATEMENT_STATUS] },
  },
  statusReason: { min: 0, max: UNBOUNDED, types: ["CodeableConcept"] },
  category: { min: 0, max: 1, types: ["CodeableConcept"] },
  medication: { min: 1, max: 1, types: ["CodeableConcept", "Reference"] },
  subject: { min: 1, max: 1, types: ["Reference"] },
  context: { min: 0, max: 1, types: ["Reference"] },
  effective: { min: 0, max: 1, types: ["dateTime", "Period"] },
  dateAsserted: { min: 0, max: 1, types: ["dateTime"] },
  informationSource: { min: 0, max: 1, types: ["Reference"] },
  derivedFrom: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  reasonCode: { min: 0, max: UNBOUNDED, types: ["CodeableConcept"] },
  reasonReference: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  note: { min: 0, max: UNBOUNDED, types: ["Annotation"] },
  dosage: { min: 0, max: UNBOUNDED, types: ["Dosage"] },
};

/**
 * The built-in schemas (base elements are merged into each). This array IS the built-in set, and it
 * is the only place that enumeration exists: `Patient`, plus every resource type this library treats
 * as safety-critical. A type is added here only once its table names every direct element R4 defines
 * for it, because the registry treats a registered type as fully described.
 */
const BUILTIN_SCHEMAS: readonly ResourceSchema[] = [
  { type: "Patient", elements: PATIENT_ELEMENTS },
  { type: "Observation", elements: OBSERVATION_ELEMENTS },
  { type: "DiagnosticReport", elements: DIAGNOSTIC_REPORT_ELEMENTS },
  { type: "Condition", elements: CONDITION_ELEMENTS },
  { type: "MedicationRequest", elements: MEDICATION_REQUEST_ELEMENTS },
  { type: "AllergyIntolerance", elements: ALLERGY_INTOLERANCE_ELEMENTS },
  { type: "Immunization", elements: IMMUNIZATION_ELEMENTS },
  { type: "MedicationStatement", elements: MEDICATION_STATEMENT_ELEMENTS },
];

/**
 * A resolver from a resource type name to its {@link ResourceSchema} (base elements merged in), or
 * `undefined` when the type is not modeled. Built by {@link buildRegistry}.
 */
export type SchemaRegistry = (resourceType: string) => ResourceSchema | undefined;

/** Merge base-resource elements under a resource's own (own elements win on a name clash). */
function withBase(schema: ResourceSchema): ResourceSchema {
  return { type: schema.type, elements: { ...BASE_ELEMENTS, ...schema.elements } };
}

/**
 * A base-elements-only schema for a resource type, the universally-true `Resource` /
 * `DomainResource` elements, and nothing resource-specific. Used to validate a resource whose type
 * is not modeled **without** emitting false "unknown element" findings for its own
 * (unmodeled) elements, the safe degrade.
 *
 * @param type - The resource type name.
 * @returns A schema carrying only the base elements.
 * @example
 * ```ts
 * import { baseSchema } from "@cosyte/fhir";
 * baseSchema("Device").elements.id; // { min: 0, max: 1, types: ["id"] }
 * ```
 */
export function baseSchema(type: string): ResourceSchema {
  return { type, elements: BASE_ELEMENTS };
}

/**
 * Build a {@link SchemaRegistry} from the built-in schemas plus any caller-supplied ones. A
 * caller schema for a type replaces the built-in for that type (so a consumer can, for example,
 * provide a resource type this package does not ship). Base elements are always merged in.
 *
 * @param extra - Additional resource schemas to register (override built-ins by type).
 * @returns A resolver from resource type to its merged schema.
 * @example
 * ```ts
 * import { buildRegistry } from "@cosyte/fhir";
 * const registry = buildRegistry();
 * registry("Patient"); // the built-in Patient schema, base elements merged in
 * registry("Device");  // undefined, not modeled
 * ```
 */
export function buildRegistry(extra: readonly ResourceSchema[] = []): SchemaRegistry {
  const byType = new Map<string, ResourceSchema>();
  for (const schema of BUILTIN_SCHEMAS) byType.set(schema.type, withBase(schema));
  for (const schema of extra) byType.set(schema.type, withBase(schema));
  return (resourceType: string): ResourceSchema | undefined => byType.get(resourceType);
}

/**
 * Resolve an instance property name against a schema, honoring `choice[x]`. A plain element matches
 * by exact name; a choice element `deceased` (types `boolean | dateTime`) matches the instance
 * property `deceasedBoolean` or `deceasedDateTime`, returning which variant datatype was chosen.
 *
 * @param elements - The resource's elements.
 * @param property - The instance property name.
 * @returns The matched element and (for a choice) the chosen datatype and the choice base name, or
 *   `undefined` when nothing matches.
 * @example
 * ```ts
 * import { resolveElement } from "@cosyte/fhir";
 * const elements = { deceased: { min: 0, max: 1, types: ["boolean", "dateTime"] } };
 * resolveElement(elements, "deceasedBoolean")?.datatype; // "boolean"
 * ```
 */
export function resolveElement(
  elements: Readonly<Record<string, ElementSchema>>,
  property: string,
):
  | { readonly element: ElementSchema; readonly datatype: string; readonly base: string }
  | undefined {
  // `Object.hasOwn` guard, not a bare `elements[property]`: a resource property literally named
  // `constructor` / `toString` / `valueOf` / `hasOwnProperty` would otherwise read an inherited
  // `Object.prototype` member (a `Function`, not an `ElementSchema`) and crash `isChoice` on its
  // absent `.types`. An adversarial resource must not be able to fault the validator. Own-property only.
  const direct = Object.hasOwn(elements, property) ? elements[property] : undefined;
  if (direct !== undefined && !isChoice(direct)) {
    return { element: direct, datatype: direct.types[0] ?? "", base: property };
  }
  // A choice[x]: find a `<base>` whose `<base><Type>` matches the property.
  for (const [base, element] of Object.entries(elements)) {
    if (!isChoice(element)) continue;
    for (const datatype of element.types) {
      const variant = base + datatype.charAt(0).toUpperCase() + datatype.slice(1);
      if (variant === property) return { element, datatype, base };
    }
  }
  return undefined;
}
