/**
 * The R4 **`patient-animal`** extension: species, breed and gender status on a veterinary Patient.
 *
 * `http://hl7.org/fhir/StructureDefinition/patient-animal` (extension-patient-animal.html) is a
 * complex extension, context `Patient`, cardinality `0..1`, with three sub-extensions, each of which
 * carries one `valueCodeableConcept`:
 *
 * - `species`, `1..1`: the high level taxonomic category, such as dog or cow;
 * - `breed`, `0..1`: the finer category, such as a breed;
 * - `genderStatus`, `0..1`: the state of the animal's reproductive organs, such as neutered.
 *
 * The extension is **draft**, maturity level 1, and each of the three bindings is an **example**
 * binding (`AnimalSpecies`, `AnimalBreed`, `AnimalGenderStatus`), so no code is required of any of
 * them and this reader checks none. The absence of the extension does not say the patient is human.
 *
 * **It reads, it never repairs.** A part is returned only when the document gives exactly one value
 * for it. Where the document gives two answers (the extension twice, a sub-extension twice, a
 * property written twice) or a value that is not a CodeableConcept, the part is left `undefined`
 * and a coded, value-free {@link ValidationIssue} says where and why.
 *
 * @packageDocumentation
 */

import {
  getAllProperties,
  isComplex,
  isList,
  resourceType,
  type FhirComplex,
  type FhirNode,
  type FhirPrimitive,
} from "../model/index.js";
import { ISSUE_SEVERITIES, validationIssue, type ValidationIssue } from "../validate/issues.js";

// Stryker disable StringLiteral: a module-level constant, evaluated once when the module loads, which the mutation runner does not reload per mutant; test/patient-animal.test.ts pins its value
/** The canonical URL of the R4 `patient-animal` extension. */
export const PATIENT_ANIMAL_EXTENSION_URL =
  "http://hl7.org/fhir/StructureDefinition/patient-animal";
// Stryker restore StringLiteral

/**
 * What {@link readPatientAnimal} read from a Patient's `patient-animal` extension. Each part is the
 * `valueCodeableConcept` model node as written, or `undefined` when the extension does not carry it
 * or carries it in a form that could not be read faithfully (an issue then says which).
 */
export interface PatientAnimal {
  /** The animal's species (`1..1` in the extension), as a CodeableConcept. */
  readonly species: FhirComplex | undefined;
  /** The animal's breed (`0..1`), as a CodeableConcept. */
  readonly breed: FhirComplex | undefined;
  /** The state of the animal's reproductive organs (`0..1`), as a CodeableConcept. */
  readonly genderStatus: FhirComplex | undefined;
  /**
   * Value-free findings about the extension: `CARDINALITY_MIN` when it lacks `species` (at
   * `Patient.extension[n].extension:species`) or a sub-extension lacks its value, `CARDINALITY_MAX`
   * when the extension or a sub-extension repeats, `TYPE_MISMATCH` or `CHOICE_AMBIGUOUS` for a value
   * that is not one CodeableConcept, and `DUPLICATE_PROPERTY` for a property the JSON wrote twice.
   * Empty when the extension was read whole.
   */
  readonly issues: readonly ValidationIssue[];
}

/** The three parts, in the order the extension's definition lists them. */
const PARTS = ["species", "breed", "genderStatus"] as const;
type Part = (typeof PARTS)[number];

/** The node's items when it is a list, or the single node wrapped. */
function asItems(node: FhirNode): readonly FhirNode[] {
  return isList(node) ? node.items : [node];
}

/**
 * `node` when it is an element whose `url` property names `url`, a repeated property included, or
 * `undefined`. A complex or list member has no `value`, so the comparison alone rules it out.
 */
function claimant(node: FhirNode, url: string): FhirComplex | undefined {
  if (!isComplex(node)) return undefined;
  const named = getAllProperties(node, "url").some((m) => (m as FhirPrimitive).value === url);
  return named ? node : undefined;
}

/** Whether an element wrote its `url` property more than once, so what it names is ambiguous. */
function repeatsUrl(node: FhirComplex): boolean {
  return getAllProperties(node, "url").length > 1;
}

/** One sub-extension's `valueCodeableConcept`, or `undefined` with the issue that says why not. */
function readValue(
  sub: FhirComplex,
  path: string,
  issues: ValidationIssue[],
): FhirComplex | undefined {
  const variants = new Set(
    sub.properties.map((p) => p.name).filter((name) => name.startsWith("value")),
  );
  if (variants.size === 0) {
    issues.push(validationIssue("CARDINALITY_MIN", ISSUE_SEVERITIES.ERROR, `${path}.value[x]`));
    return undefined;
  }
  if (variants.size > 1) {
    issues.push(validationIssue("CHOICE_AMBIGUOUS", ISSUE_SEVERITIES.ERROR, `${path}.value[x]`));
    return undefined;
  }
  if (!variants.has("valueCodeableConcept")) {
    issues.push(validationIssue("TYPE_MISMATCH", ISSUE_SEVERITIES.ERROR, `${path}.value[x]`));
    return undefined;
  }
  const values = getAllProperties(sub, "valueCodeableConcept");
  if (values.length > 1) {
    issues.push(
      validationIssue("DUPLICATE_PROPERTY", ISSUE_SEVERITIES.ERROR, `${path}.valueCodeableConcept`),
    );
    return undefined;
  }
  const value = values[0] as FhirNode;
  if (!isComplex(value)) {
    issues.push(
      validationIssue("TYPE_MISMATCH", ISSUE_SEVERITIES.ERROR, `${path}.valueCodeableConcept`),
    );
    return undefined;
  }
  return value;
}

/** A readout that reads no part, carrying the issues that say why. */
function refused(issues: readonly ValidationIssue[]): PatientAnimal {
  return { species: undefined, breed: undefined, genderStatus: undefined, issues };
}

/**
 * Read species, breed and gender status from a Patient's `patient-animal` extension
 * (`http://hl7.org/fhir/StructureDefinition/patient-animal`), each as the CodeableConcept model node
 * the document wrote.
 *
 * Returns `undefined` when the resource is not a Patient or carries no such extension. Otherwise each
 * part is its CodeableConcept, or `undefined` when absent; a missing `species` (`1..1`) is reported
 * as `CARDINALITY_MIN` at `Patient.extension[n].extension:species`. A part the document gives more
 * than one answer for, or gives in another type, is not read and is reported instead (see
 * {@link PatientAnimal.issues}). The extension is draft (maturity level 1) and its bindings are
 * examples only, so no code is checked.
 *
 * @param resource - The resource model.
 * @returns The parts read, with their issues, or `undefined` when there is no animal extension.
 * @example
 * ```ts
 * import { parseResource, readPatientAnimal } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   JSON.stringify({
 *     resourceType: "Patient",
 *     extension: [
 *       {
 *         url: "http://hl7.org/fhir/StructureDefinition/patient-animal",
 *         extension: [{ url: "species", valueCodeableConcept: { text: "Synthetic species" } }],
 *       },
 *     ],
 *   }),
 * );
 * const animal = readPatientAnimal(resource);
 * animal?.species; // the CodeableConcept node
 * animal?.breed; // undefined
 * animal?.issues; // []
 * ```
 */
export function readPatientAnimal(resource: FhirComplex): PatientAnimal | undefined {
  if (resourceType(resource) !== "Patient") return undefined;

  const members = getAllProperties(resource, "extension");
  const found: { readonly node: FhirComplex; readonly index: number }[] = [];
  for (const member of members) {
    asItems(member).forEach((item, index) => {
      const node = claimant(item, PATIENT_ANIMAL_EXTENSION_URL);
      if (node !== undefined) found.push({ node, index });
    });
  }
  const first = found[0];
  if (first === undefined) return undefined;
  if (members.length > 1) {
    return refused([
      validationIssue("DUPLICATE_PROPERTY", ISSUE_SEVERITIES.ERROR, "Patient.extension"),
    ]);
  }
  if (found.length > 1) {
    return refused(
      found
        .slice(1)
        .map(({ index }) =>
          validationIssue(
            "CARDINALITY_MAX",
            ISSUE_SEVERITIES.ERROR,
            `Patient.extension[${String(index)}]`,
          ),
        ),
    );
  }
  const base = `Patient.extension[${String(first.index)}]`;
  if (repeatsUrl(first.node)) {
    return refused([validationIssue("DUPLICATE_PROPERTY", ISSUE_SEVERITIES.ERROR, `${base}.url`)]);
  }

  const subMembers = getAllProperties(first.node, "extension");
  if (subMembers.length > 1) {
    return refused([
      validationIssue("DUPLICATE_PROPERTY", ISSUE_SEVERITIES.ERROR, `${base}.extension`),
    ]);
  }
  const subs = subMembers.flatMap(asItems);

  const issues: ValidationIssue[] = [];
  // A sub-extension that wrote its url twice and names a part is reported once, however many
  // parts it names, and no part it names is read.
  subs.forEach((item, index) => {
    if (
      isComplex(item) &&
      repeatsUrl(item) &&
      PARTS.some((part) => claimant(item, part) !== undefined)
    ) {
      issues.push(
        validationIssue(
          "DUPLICATE_PROPERTY",
          ISSUE_SEVERITIES.ERROR,
          `${base}.extension[${String(index)}].url`,
        ),
      );
    }
  });
  const values: Record<Part, FhirComplex | undefined> = {
    species: undefined,
    breed: undefined,
    genderStatus: undefined,
  };
  for (const part of PARTS) {
    const claimed: { readonly node: FhirComplex; readonly index: number }[] = [];
    let ambiguous = false;
    subs.forEach((item, index) => {
      const node = claimant(item, part);
      if (node === undefined) return;
      if (repeatsUrl(node)) ambiguous = true;
      else claimed.push({ node, index });
    });
    if (ambiguous) continue;
    const one = claimed[0];
    if (one === undefined) {
      if (part === "species") {
        issues.push(
          validationIssue("CARDINALITY_MIN", ISSUE_SEVERITIES.ERROR, `${base}.extension:species`),
        );
      }
      continue;
    }
    if (claimed.length > 1) {
      for (const { index } of claimed.slice(1)) {
        issues.push(
          validationIssue(
            "CARDINALITY_MAX",
            ISSUE_SEVERITIES.ERROR,
            `${base}.extension[${String(index)}]`,
          ),
        );
      }
      continue;
    }
    values[part] = readValue(one.node, `${base}.extension[${String(one.index)}]`, issues);
  }

  return { ...values, issues };
}
