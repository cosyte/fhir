/**
 * The publishable **profile starter kit**, spec-grounded example profiles, each
 * authored through the public {@link defineProfile} API.
 *
 * These are *templates*, not authoritative conformance statements. Each is a small, self-contained
 * `StructureDefinition` a consumer can pass straight to `validateResource({ profiles })`, read as a
 * worked example, or copy as the skeleton for their own site/vendor profile. Every constraint here is
 * grounded in a **public FHIR / US Core specification page**, nothing is
 * invented, and no instance data is encoded. (A *named real-vendor* profile, one that asserts a
 * specific EHR's real-world constraints, is deliberately **out of scope here**: it may only be
 * encoded when a real, de-identified vendor artifact grounds it.)
 *
 * **They dogfood the public path.** Nothing here reaches for a privileged internal builder: a starter
 * profile is `defineProfile(spec)`, exactly what a user writes. That is the point of the growth
 * loop, the built-in profiles and a user's profiles are the same kind of object, built the same way.
 *
 * **Self-contained by design.** Each starter carries only a `differential` and no `baseDefinition`, so
 * it validates the elements it names without a base-resource resolver or any bundled base
 * `StructureDefinition` (no profile content is bundled). A *derived* profile in production
 * would set `baseDefinition` and be validated with the base resource's snapshot available; these
 * starters trade that for running out of the box as teaching examples.
 *
 * @packageDocumentation
 */

import { PATIENT_ANIMAL_EXTENSION_URL } from "../helpers/patient-animal.js";
import { complex, list, primitive } from "../model/node.js";
import { OBSERVATION_CATEGORY_SYSTEM, VITAL_SIGNS_CATEGORY } from "../quantity/ucum.js";
import { defineProfile, type ProfileElementSpec } from "./define-profile.js";
import type { StructureDefinition } from "./structure-definition.js";

/** The canonical URL prefix the starter-kit profiles are published under. */
export const STARTER_PROFILE_BASE_URL = "https://cosyte.com/fhir/StructureDefinition";

/**
 * A **vital-sign `Observation`** starter, grounded in `observation-vitalsigns.html` + US Core Vital
 * Signs: `status` is required, `code` is required + must-support, and `category` is **sliced**, a
 * required `VSCat` slice pins the `vital-signs` category coding, while the slicing stays **`open`** so
 * an instance may *also* carry other categories (e.g. `laboratory`). This mirrors how the real vital-
 * signs profile constrains `category` (a slice, **not** a bare pattern on the repeating element, a
 * bare pattern would wrongly require *every* category entry to be `vital-signs` and reject a valid
 * multi-category Observation). It exercises the profile engine's `pattern`/`$this` slicing
 * discriminator. Fixed UCUM units per vital sign are surfaced by the quantity layer
 * (`VITAL_SIGN_UNITS`), not re-encoded here.
 */
export const VITAL_SIGN_OBSERVATION_STARTER: StructureDefinition = defineProfile({
  url: `${STARTER_PROFILE_BASE_URL}/starter-vital-sign-observation`,
  name: "StarterVitalSignObservation",
  type: "Observation",
  differential: [
    { path: "Observation.status", min: 1, max: 1, mustSupport: true },
    {
      path: "Observation.category",
      min: 1,
      max: "*",
      mustSupport: true,
      // Open slicing on a pattern/$this discriminator: the VSCat slice below is required, but other
      // (unmatched) category entries are allowed, the whole point of slicing over a bare pattern.
      slicing: { discriminator: [{ type: "pattern", path: "$this" }], rules: "open" },
    },
    {
      path: "Observation.category",
      id: "Observation.category:VSCat",
      sliceName: "VSCat",
      min: 1,
      max: 1,
      mustSupport: true,
      pattern: {
        type: "CodeableConcept",
        value: complex([
          {
            name: "coding",
            value: list([
              complex([
                { name: "system", value: primitive(OBSERVATION_CATEGORY_SYSTEM) },
                { name: "code", value: primitive(VITAL_SIGNS_CATEGORY) },
              ]),
            ]),
          },
        ]),
      },
    },
    { path: "Observation.code", min: 1, max: 1, mustSupport: true },
  ],
});

/**
 * A **`Patient` identifier** starter, grounded in US Core Patient. It marks
 * `identifier`, `identifier.system`, and `identifier.value` required + must-support, a patient
 * identity is the `(system, value)` tuple. It deliberately does **not** slice an "MRN" slice and does
 * **not** bind `identifier.type`: US Core does neither, and inventing an MRN slice is exactly the
 * wrong-patient-merge hazard.
 */
export const PATIENT_IDENTIFIER_STARTER: StructureDefinition = defineProfile({
  url: `${STARTER_PROFILE_BASE_URL}/starter-patient-identifier`,
  name: "StarterPatientIdentifier",
  type: "Patient",
  differential: [
    { path: "Patient.identifier", min: 1, max: "*", mustSupport: true },
    { path: "Patient.identifier.system", min: 1, max: 1, mustSupport: true },
    { path: "Patient.identifier.value", min: 1, max: 1, mustSupport: true },
  ],
});

// Stryker disable all: the veterinary starter is built once, when the module loads, which the mutation runner does not reload per mutant; test/starter-kit.test.ts pins its whole differential and validates instances against it
/** A `value` discriminator on `url`, the way R4 slices an extension list. */
const BY_URL = { discriminator: [{ type: "value", path: "url" }], rules: "open" } as const;

/** One sub-extension slice of `patient-animal`, as extension-patient-animal.html defines it. */
function animalPart(name: string, min: number, valueSet: string): readonly ProfileElementSpec[] {
  const id = `Patient.extension:animal.extension:${name}`;
  return [
    {
      path: "Patient.extension.extension",
      id,
      sliceName: name,
      min,
      max: 1,
    },
    {
      path: "Patient.extension.extension.url",
      id: `${id}.url`,
      fixed: { type: "Uri", value: primitive(name) },
    },
    {
      path: "Patient.extension.extension.value[x]",
      id: `${id}.value[x]`,
      min: 1,
      type: [{ code: "CodeableConcept" }],
      binding: { strength: "example", valueSet },
    },
  ];
}

/**
 * A **veterinary `Patient`** starter, grounded in the R4 `patient-animal` extension
 * (extension-patient-animal.html). It slices `Patient.extension` by `url` and requires exactly one
 * `animal` slice, pinned to {@link PATIENT_ANIMAL_EXTENSION_URL}, inside which `species` is required
 * (`1..1`) and `breed` and `genderStatus` are allowed once each (`0..1`), every one carrying a
 * `valueCodeableConcept`. The slicing stays **`open`**, so other extensions may sit beside it.
 *
 * The extension is **draft**, maturity level 1, and its three bindings (`AnimalSpecies`,
 * `AnimalBreed`, `AnimalGenderStatus`) are **example** bindings: they are carried here as written,
 * and no code is required of any of them. Read the parts with `readPatientAnimal`.
 *
 * It is not in {@link STARTER_PROFILES}: a profile there applies to every resource of its type, and
 * this one would report every human Patient as missing the extension. Pass it on its own, for the
 * Patients you know are animals, or look it up with {@link starterProfile}.
 */
export const VETERINARY_PATIENT_STARTER: StructureDefinition = defineProfile({
  url: `${STARTER_PROFILE_BASE_URL}/starter-veterinary-patient`,
  name: "StarterVeterinaryPatient",
  type: "Patient",
  differential: [
    { path: "Patient.extension", slicing: BY_URL },
    {
      path: "Patient.extension",
      id: "Patient.extension:animal",
      sliceName: "animal",
      min: 1,
      max: 1,
      mustSupport: true,
      type: [{ code: "Extension", profile: [PATIENT_ANIMAL_EXTENSION_URL] }],
    },
    {
      path: "Patient.extension.extension",
      id: "Patient.extension:animal.extension",
      slicing: BY_URL,
    },
    ...animalPart("species", 1, "http://hl7.org/fhir/ValueSet/animal-species"),
    ...animalPart("breed", 0, "http://hl7.org/fhir/ValueSet/animal-breeds"),
    ...animalPart("genderStatus", 0, "http://hl7.org/fhir/ValueSet/animal-genderstatus"),
    {
      path: "Patient.extension.url",
      id: "Patient.extension:animal.url",
      fixed: { type: "Uri", value: primitive(PATIENT_ANIMAL_EXTENSION_URL) },
    },
  ],
});
// Stryker restore all

/**
 * Every starter-kit profile that applies to any resource of its type. Iterate this to register the
 * whole kit as a validation profile set, or pick one by `url`, a starting point a consumer extends
 * with their own site/vendor constraints. {@link VETERINARY_PATIENT_STARTER} is left out, since it
 * applies only to a Patient that is an animal.
 *
 * @example
 * ```ts
 * import { STARTER_PROFILES, parseResource, validateResource } from "@cosyte/fhir";
 * const { resource } = parseResource(observationJson);
 * const { issues } = validateResource(resource, { profiles: [...STARTER_PROFILES] });
 * ```
 */
export const STARTER_PROFILES: readonly StructureDefinition[] = [
  VITAL_SIGN_OBSERVATION_STARTER,
  PATIENT_IDENTIFIER_STARTER,
];

/**
 * Look up a starter profile by its canonical `url`, {@link VETERINARY_PATIENT_STARTER} included.
 *
 * @param url - The canonical URL (see each profile's `url`, or {@link STARTER_PROFILE_BASE_URL}).
 * @returns The matching starter profile, or `undefined`.
 * @example
 * ```ts
 * import { starterProfile, STARTER_PROFILE_BASE_URL } from "@cosyte/fhir";
 * const p = starterProfile(`${STARTER_PROFILE_BASE_URL}/starter-patient-identifier`);
 * ```
 */
export function starterProfile(url: string): StructureDefinition | undefined {
  return [...STARTER_PROFILES, VETERINARY_PATIENT_STARTER].find((p) => p.url === url);
}
