---
id: quickstart
title: Quickstart
sidebar_position: 3
---

# Quickstart

Five minutes, one file, and four steps: an unparsed FHIR document, a parsed resource, one clinically
meaningful value read off it, and a validation verdict. Everything below uses the package's public
entry point and nothing else.

Start from an empty file, `first-read.ts`, in a project that already
[has the package](./installation.md).

## 1. The document

This is a synthetic systolic blood pressure, written the way a server would send it. Every value in
it is fabricated, and the identifiers are declared synthetic in this repository:

```json
{
  "resourceType": "Observation",
  "id": "syn-0001",
  "status": "final",
  "code": { "coding": [{ "system": "http://loinc.org", "code": "8480-6" }] },
  "subject": { "reference": "Patient/syn-0001" },
  "effectiveDateTime": "2026-01-05",
  "valueQuantity": {
    "value": 120.0,
    "unit": "mmHg",
    "system": "http://unitsofmeasure.org",
    "code": "mm[Hg]"
  }
}
```

## 2. Read it

`parseResource` takes the document text and returns two things: the resource model, and the
diagnostics the read produced. It never throws for content it can keep, and it never rewrites a
value to make it fit.

```ts
import { parseResource } from "@cosyte/fhir";

const document = `{
  "resourceType": "Observation",
  "id": "syn-0001",
  "status": "final",
  "code": { "coding": [{ "system": "http://loinc.org", "code": "8480-6" }] },
  "subject": { "reference": "Patient/syn-0001" },
  "effectiveDateTime": "2026-01-05",
  "valueQuantity": {
    "value": 120.0,
    "unit": "mmHg",
    "system": "http://unitsofmeasure.org",
    "code": "mm[Hg]"
  }
}`;

const { resource, issues } = parseResource(document);

resource.kind; // => "complex"
issues.map((issue) => issue.code); // => ["DECIMAL_PRECISION_AT_RISK"]
```

That single diagnostic is the point of the codec rather than a complaint about the document. The
magnitude was written `120.0`, and a reader that routed it through a JavaScript number would hand
you back `120`, silently losing the precision the sender chose to state. This one keeps the exact
lexical form and tells you the protection mattered here.

## 3. Read a value off it

A blood pressure is only useful as a magnitude with a unit. `readObservationValue` reports which
`value[x]` variant is actually present, so a caller can never read a coded or free-text result as if
it were a number:

```ts
import { parseResource, readObservationValue } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Observation","status":"final","valueQuantity":{"value":120.0,"unit":"mmHg","system":"http://unitsofmeasure.org","code":"mm[Hg]"}}',
);

const reading = readObservationValue(resource);

reading?.type; // => "Quantity"
reading?.quantity?.value?.raw; // => "120.0"
reading?.quantity?.code; // => "mm[Hg]"
reading?.quantity?.unit; // => "mmHg"
```

Two habits worth forming here. Branch on `type` before you touch `quantity`, because a
`valueString` of `"POSITIVE"` is a perfectly ordinary Observation result and has no magnitude at
all. And compare on `code`, the machine-actionable UCUM unit, never on `unit`, which is a display
string a sender is free to spell however it likes.

## 4. Get a verdict

`validateResource` walks the resource once and returns coded findings plus a single `valid` flag.
Warnings and informational findings do not make a resource invalid; errors do.

```ts
import { parseResource, validateResource } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Observation","status":"final","code":{"coding":[{"system":"http://loinc.org","code":"8480-6"}]}}',
);

const outcome = validateResource(resource);

outcome.valid; // => true
outcome.issues; // => []
```

Now break it. An unknown `modifierExtension` is the one shape the library refuses to read past: a
modifier changes the meaning of the element it sits on, so processing the resource as if it were
absent is how a negation gets lost.

```ts
import { parseResource, validateResource } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Patient","modifierExtension":[{"url":"http://example.org/local-flag","valueBoolean":true}]}',
);

const outcome = validateResource(resource);

outcome.valid; // => false
outcome.issues.map((issue) => issue.code); // => ["UNHANDLED_MODIFIER_EXTENSION"]
outcome.issues.map((issue) => issue.expression); // => ["Patient.modifierExtension[0]"]
```

Notice what the finding carries: a coded reason and a location, and no slice of the document. That
is a contract, not a coincidence, and [core concepts](./core-concepts.md) explains what rests on it.

## Where to go next

- [Core concepts](./core-concepts.md) for the model, the two codecs and the validation layers.
- [Guides](./guides.md) for profiles, safety readouts and cross-format work.
- [Current limits](./limits.md) for what the package deliberately does not do.
- [Troubleshooting](./troubleshooting.md) when a document is refused or read in a degraded way.
