---
id: read-veterinary-patients
title: Read and require the animal of a veterinary Patient
sidebar_label: Read veterinary patients
description: "Read species, breed and gender status from the R4 patient-animal extension, and validate a veterinary Patient against a starter profile that requires it."
---

# Read and require the animal of a veterinary Patient

R4 has no element for a patient's species. A veterinary Patient carries it in the
`patient-animal` extension, `http://hl7.org/fhir/StructureDefinition/patient-animal`, which holds
three parts, each a `CodeableConcept`:

| Part           | Cardinality | Binding                        |
| -------------- | ----------- | ------------------------------ |
| `species`      | `1..1`      | `AnimalSpecies`, example       |
| `breed`        | `0..1`      | `AnimalBreed`, example         |
| `genderStatus` | `0..1`      | `AnimalGenderStatus`, example  |

Know what the extension is before you build on it. It is **draft**, at maturity level **1**, so a
later FHIR release may change it. Its three bindings are **example** bindings only: they suggest
codes and require none, so a sender may use any code system, and neither the reader nor the starter
profile below checks a code. The extension itself is `0..1` on a Patient, and its absence does not
say the patient is human.

## Read the three parts

`readPatientAnimal` returns each part as the `CodeableConcept` model node the document wrote, or
`undefined` when the part is absent. It returns `undefined` for a resource that is not a Patient or
that carries no animal extension:

```ts runnable
import { getProperty, parseResource, readPatientAnimal } from "@cosyte/fhir";

const { resource } = parseResource(
  JSON.stringify({
    resourceType: "Patient",
    id: "syn-vet-0001",
    extension: [
      {
        url: "http://hl7.org/fhir/StructureDefinition/patient-animal",
        extension: [
          { url: "species", valueCodeableConcept: { text: "Synthetic species" } },
          { url: "genderStatus", valueCodeableConcept: { text: "Synthetic status" } },
        ],
      },
    ],
  }),
);

const animal = readPatientAnimal(resource);

const species = animal?.species;
const text = species === undefined ? undefined : getProperty(species, "text");

text?.kind === "primitive" ? text.value : undefined; // => "Synthetic species"
animal?.breed; // => undefined
animal?.issues; // => []

const human = parseResource('{"resourceType":"Patient","id":"syn-0001"}').resource;
readPatientAnimal(human); // => undefined
```

## Act on what it reports

A part is read only when the document gives exactly one value for it. Anything else leaves the part
`undefined` and adds a coded, value-free issue to `issues`, located by FHIRPath:

- the extension without `species`: `CARDINALITY_MIN` at `Patient.extension[n].extension:species`;
- the extension or a part written twice: `CARDINALITY_MAX`, and no part is picked;
- a part with no value: `CARDINALITY_MIN` at its `value[x]`;
- a value that is not one `CodeableConcept`: `TYPE_MISMATCH` or `CHOICE_AMBIGUOUS`;
- a property the JSON repeated: `DUPLICATE_PROPERTY`.

```ts runnable
import { parseResource, readPatientAnimal } from "@cosyte/fhir";

const { resource } = parseResource(
  JSON.stringify({
    resourceType: "Patient",
    extension: [
      {
        url: "http://hl7.org/fhir/StructureDefinition/patient-animal",
        extension: [{ url: "breed", valueCodeableConcept: { text: "Synthetic breed" } }],
      },
    ],
  }),
);

const animal = readPatientAnimal(resource);

animal?.species; // => undefined
animal?.issues.map((i) => i.code); // => ["CARDINALITY_MIN"]
animal?.issues.map((i) => i.expression); // => ["Patient.extension[0].extension:species"]
```

## Require the extension with the starter profile

`VETERINARY_PATIENT_STARTER` pins the extension for a veterinary Patient: one `animal` slice of
`Patient.extension`, fixed to the extension's URL, with `species` required and `breed` and
`genderStatus` allowed once each. It carries the three example bindings as the extension defines
them, and like every binding on a profile they are not enforced.

It is not in `STARTER_PROFILES`, because a profile there is applied to every Patient, and this one
would report every human patient as missing the extension. Pass it on its own for the Patients you
know are animals:

```ts runnable
import { parseResource, validateResource, VETERINARY_PATIENT_STARTER } from "@cosyte/fhir";

const { resource } = parseResource('{"resourceType":"Patient","id":"syn-vet-0002"}');

const { issues } = validateResource(resource, { profiles: [VETERINARY_PATIENT_STARTER] });

issues.map((i) => i.code); // => ["MUST_SUPPORT_ABSENT", "CARDINALITY_MIN"]
issues.map((i) => i.expression); // => ["Patient.extension:animal", "Patient.extension:animal"]
```

`starterProfile` finds it by its URL too. [Validate against profiles](./validate-against-profiles.md)
covers the profile engine and the rest of the starter kit.
