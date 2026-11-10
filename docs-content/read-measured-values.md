---
id: read-measured-values
title: Read measured values and their units
sidebar_label: Read measured values
description: "Read an Observation's value by its type, a quantity's exact magnitude and UCUM unit, medication doses and reference ranges, with no unit ever converted."
---

# Read measured values and their units

A measured value is a magnitude, a unit, and a type, and each of the three can be misread. These
readers keep all three as the document wrote them: the magnitude as its exact text, the coded unit
apart from the display string, and the `value[x]` variant that is actually present. Nothing here
converts a unit or computes a flag.

## Read an Observation's value by its type

`readObservationValue` names the `value[x]` variant that is present. `quantity` is filled in only
when that variant is a `Quantity`, so branch on `type` first:

```ts runnable
import { parseResource, readObservationValue } from "@cosyte/fhir";

const numeric = parseResource(
  '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"},"valueQuantity":{"value":120.0,"unit":"mmHg","system":"http://unitsofmeasure.org","code":"mm[Hg]"}}',
).resource;

const reading = readObservationValue(numeric);

reading?.type; // => "Quantity"
reading?.quantity?.value?.raw; // => "120.0"
reading?.quantity?.code; // => "mm[Hg]"
reading?.quantity?.unit; // => "mmHg"

const text = parseResource(
  '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"},"valueString":"POSITIVE"}',
).resource;

readObservationValue(text)?.type; // => "String"
readObservationValue(text)?.quantity; // => undefined
```

Compare on `code`, the machine-actionable UCUM unit, never on `unit`, which is a display string a
sender is free to spell however it likes.

## Keep the magnitude exact

The magnitude is a `FhirDecimal`, the exact text the sender wrote. `equals` treats `120.0` and `120`
as different statements, because the trailing zero records the precision; `equalsValue` compares
the quantity alone:

```ts runnable
import { decimal, parseResource, readObservationValue } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"},"valueQuantity":{"value":0.010,"system":"http://unitsofmeasure.org","code":"mg"}}',
);

const value = readObservationValue(resource)?.quantity?.value;

value?.toString(); // => "0.010"
value?.equals(decimal("0.01")); // => false
value?.equalsValue(decimal("0.01")); // => true
```

`toNumber` is there for when you have decided the precision loss of a JavaScript number is
acceptable; nothing in the package calls it for you.

## Read medication doses

`readMedicationDoses` reads every dose quantity of a `MedicationRequest` (`dosageInstruction`) or a
`MedicationStatement` (`dosage`), in document order. Pass the resource type, which
`resourceType` reads for you:

```ts runnable
import { parseResource, readMedicationDoses, resourceType } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"MedicationRequest","status":"active","intent":"order","subject":{"reference":"Patient/syn-0001"},"dosageInstruction":[{"doseAndRate":[{"doseQuantity":{"value":5,"unit":"mg","system":"http://unitsofmeasure.org","code":"mg"}}]}]}',
);

const doses = readMedicationDoses(resource, resourceType(resource));

doses.map((dose) => [dose.value?.raw, dose.code]); // => [["5", "mg"]]
```

## Read reference ranges and interpretation flags

`readReferenceRanges` and `readInterpretations` surface what the sender wrote. Neither derives a
flag from a value and a range: an abnormal flag is the sender's statement, read as written.

```ts runnable
import { parseResource, readInterpretations, readReferenceRanges } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"},"valueQuantity":{"value":100,"system":"http://unitsofmeasure.org","code":"mg/dL"},"referenceRange":[{"low":{"value":70,"system":"http://unitsofmeasure.org","code":"mg/dL"},"high":{"value":99,"system":"http://unitsofmeasure.org","code":"mg/dL"}}],"interpretation":[{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation","code":"N"}]}]}',
);

const [range] = readReferenceRanges(resource);

range?.low?.value?.raw; // => "70"
range?.high?.value?.raw; // => "99"
readInterpretations(resource).map((flag) => flag.code); // => ["N"]
```

## Check a vital sign's unit

The R4 vital-signs profile requires particular UCUM units for each vital sign. `validateResource`
checks them on an Observation that declares the `vital-signs` category or names the vital-signs
profile in `meta.profile`, on its value and on each component's, for the LOINC codes that profile
lists. It checks the unit; it never converts one. `requiredVitalSignUnits` returns the units
required for a LOINC code, and `undefined` for a code the profile does not list:

```ts runnable
import { parseResource, requiredVitalSignUnits, validateResource } from "@cosyte/fhir";

requiredVitalSignUnits("8480-6"); // => ["mm[Hg]"]

const { resource } = parseResource(
  '{"resourceType":"Observation","status":"final","category":[{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/observation-category","code":"vital-signs"}]}],"code":{"coding":[{"system":"http://loinc.org","code":"8480-6"}]},"valueQuantity":{"value":120,"unit":"mmHg","system":"http://unitsofmeasure.org","code":"mmHg"}}',
);

const outcome = validateResource(resource);

outcome.valid; // => false
outcome.issues.map((issue) => [issue.code, issue.expression]); // => [["VITAL_SIGN_UNIT_NONCONFORMANT", "Observation.valueQuantity"]]
```

## Reference

- [`readObservationValue`](./api/README.md#readobservationvalue) and
  [`ObservationValue`](./api/README.md#observationvalue).
- [`readQuantity`](./api/README.md#readquantity), which reads any `Quantity` node, and the
  [`Quantity`](./api/README.md#quantity-1) reading every reader here returns.
- [`FhirDecimal`](./api/README.md#fhirdecimal) and [`decimal`](./api/README.md#decimal).
- [`readMedicationDoses`](./api/README.md#readmedicationdoses),
  [`readReferenceRanges`](./api/README.md#readreferenceranges) and
  [`readInterpretations`](./api/README.md#readinterpretations).
- [`requiredVitalSignUnits`](./api/README.md#requiredvitalsignunits),
  [`VITAL_SIGN_UNITS`](./api/README.md#vital_sign_units) and
  [`validateUcumShape`](./api/README.md#validateucumshape).
- [Core concepts](./core-concepts.md#numbers-stay-exactly-as-they-were-written) explains why a
  magnitude is never a JavaScript number.
