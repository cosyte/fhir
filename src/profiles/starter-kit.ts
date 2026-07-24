/**
 * The publishable **profile starter kit** (Phase 10, half a), spec-grounded example profiles, each
 * authored through the public {@link defineProfile} API.
 *
 * These are *templates*, not authoritative conformance statements. Each is a small, self-contained
 * `StructureDefinition` a consumer can pass straight to `validateResource({ profiles })`, read as a
 * worked example, or copy as the skeleton for their own site/vendor profile. Every constraint here is
 * grounded in a **public FHIR / US Core specification page** already cited in the roadmap, nothing is
 * invented, and no instance data is encoded. (A *named real-vendor* profile, one that asserts a
 * specific EHR's real-world constraints, is deliberately **out of this slice**: like the Tier-2 quirk
 * corpus, it may only be encoded when a real, de-identified vendor artifact grounds it, and is
 * deferred to `REAL-CORPUS`.)
 *
 * **They dogfood the public path.** Nothing here reaches for a privileged internal builder: a starter
 * profile is `defineProfile(spec)`, exactly what a user writes. That is the point of the growth
 * loop, the built-in profiles and a user's profiles are the same kind of object, built the same way.
 *
 * **Self-contained by design.** Each starter carries only a `differential` and no `baseDefinition`, so
 * it validates the elements it names without a base-resource resolver or any bundled base
 * `StructureDefinition` (roadmap §5: no profile content is bundled). A *derived* profile in production
 * would set `baseDefinition` and be validated with the base resource's snapshot available; these
 * starters trade that for running out of the box as teaching examples.
 *
 * @packageDocumentation
 */

import { complex, list, primitive } from "../model/node.js";
import { OBSERVATION_CATEGORY_SYSTEM, VITAL_SIGNS_CATEGORY } from "../quantity/ucum.js";
import { defineProfile } from "./define-profile.js";
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
 * discriminator. Fixed UCUM units per vital sign are surfaced by the Phase-4 quantity layer
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
 * A **`Patient` identifier** starter, grounded in US Core Patient (roadmap §4.2). It marks
 * `identifier`, `identifier.system`, and `identifier.value` required + must-support, a patient
 * identity is the `(system, value)` tuple. It deliberately does **not** slice an "MRN" slice and does
 * **not** bind `identifier.type`: US Core does neither, and inventing an MRN slice is exactly the
 * wrong-patient-merge hazard the roadmap warns against.
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

/**
 * Every starter-kit profile. Iterate this to register the whole kit as a validation profile set, or
 * pick one by `url`, a starting point a consumer extends with their own site/vendor constraints.
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
 * Look up a starter profile by its canonical `url`.
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
  return STARTER_PROFILES.find((p) => p.url === url);
}
