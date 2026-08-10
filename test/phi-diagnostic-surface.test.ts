/**
 * The diagnostic-surface gate: no name a **document** supplies reaches a finding unbounded.
 *
 * This is the shared `@cosyte/test-utils` runner, so the contract it proves is the same one every
 * cosyte parser is held to, and it is deliberately narrow: for each declared slot, no verbatim echo
 * of four or more bytes of the planted marker appears in any swept surface, and the slot provably
 * reached the diagnostic code it names. It does not prove the absence of a re-encoded echo, an echo
 * under four bytes, or a leak through a slot nobody declared.
 *
 * **The slot table is the deliverable.** Every position below is one a sender controls, and the two
 * that carry this package's whole exposure are the two that are not values at all: a JSON property
 * name and the `resourceType` string. Both root or segment a FHIRPath `expression`, which is what a
 * finding carries instead of a value, so they were the one route by which document bytes of
 * unbounded length reached a diagnostic.
 *
 * **One position the shared runner structurally cannot sweep.** `getDiagnostics` collects what a
 * parse *returned*; a `FhirCodecError` thrown for a misaligned `_`-sibling carries an `expression`
 * on the thrown value instead. The runner does sweep a throw when the whole `parse` call throws, so
 * that route is covered here, but a slot whose diagnostic is only ever reached by throwing cannot
 * also assert `expectCode` through the returned-diagnostics channel. `derived-names.test.ts` covers
 * the thrown locations directly.
 *
 * **Where this gate bottoms out, and it is invisible from inside it.** The bound is a shape test,
 * and the shared marker does not satisfy that shape, which is the only reason these slots come back
 * green. A forgery that *does* satisfy it is still echoed. `derived-names.test.ts` pins that
 * residue with a live example, next to the mechanism it belongs to.
 */

import { assertNoDiagnosticPhiLeak, type DiagnosticSlot } from "@cosyte/test-utils";
import { describe, it } from "vitest";

import {
  parseResource,
  parseResourceXml,
  readSafety,
  serializeResource,
  validateResource,
  type ValidationMode,
} from "../src/index.js";

/** Everything one run of the pipeline produced that a consumer could log. */
interface Surfaces {
  readonly diagnostics: readonly unknown[];
  readonly identifiers: readonly string[];
}

/**
 * Run the whole JSON pipeline and collect every diagnostic collection it has.
 *
 * `getDiagnostics` has to return read issues, validation findings, the rendered `OperationOutcome`,
 * and the location lists on the safety readout, which are findings in everything but name.
 *
 * **It does NOT sweep every location list, and the shortfall is named rather than counted.**
 * `droppedText`, `unreadableBooleans` and `nearMissNegationCodes` are not collected here, a
 * `PRE-EXISTING` gap this slice widens by nothing: `unreadableNegationCodes`, the channel it adds,
 * IS collected below. Closing the other three is its own slice.
 */
function runJson(text: string, mode: ValidationMode): Surfaces {
  const { resource, issues } = parseResource(text);
  const result = validateResource(resource, { mode });
  const safety = readSafety(resource);
  return {
    diagnostics: [
      ...issues,
      ...result.issues,
      serializeResource(result.toOperationOutcome()),
      ...safety.unhandledModifierExtensions,
      ...safety.shadowedProperties,
      ...safety.arrayWrappedScalars,
      ...safety.nestedArrays,
      ...safety.unreadableNegationCodes,
    ],
    // The one derived identifier this package's model surfaces. The raw property names on
    // `FhirComplex` are deliberately absent: they are document content the writer reproduces
    // byte for byte, so bounding them would be data loss, not redaction. See `phi-leak.test.ts`.
    identifiers: [safety.resourceType ?? ""],
  };
}

/** The same for the XML pipeline, which builds its locations out of element and attribute names. */
function runXml(text: string, mode: ValidationMode): Surfaces {
  const { resource, issues } = parseResourceXml(text);
  const result = validateResource(resource, { mode });
  const safety = readSafety(resource);
  return {
    diagnostics: [
      ...issues,
      ...result.issues,
      serializeResource(result.toOperationOutcome()),
      ...safety.unhandledModifierExtensions,
      ...safety.shadowedProperties,
      ...safety.arrayWrappedScalars,
      ...safety.nestedArrays,
      ...safety.unreadableNegationCodes,
    ],
    identifiers: [safety.resourceType ?? ""],
  };
}

/** A `Patient` (the one resource type with a built-in schema) carrying `extra` at its root. */
function patientWith(extra: string): string {
  return `{"resourceType":"Patient","gender":"male",${extra}}`;
}

const FHIR_NS = "http://hl7.org/fhir";

/**
 * The slots are declared as a table and run **one per test** on purpose. The runner aborts on the
 * first violation, so a single call grades only up to the first red slot and says nothing about the
 * rest, which is precisely the measurement anyone re-running this against an unfixed tree needs.
 */
const JSON_SLOTS: readonly DiagnosticSlot<string>[] = [
  {
    // The expression ROOT. Every finding on the resource is prefixed with it, so an unbounded
    // echo here is an unbounded echo on every diagnostic the document draws at once.
    name: "$.resourceType (the expression root)",
    plant: (m) => `{"resourceType":${JSON.stringify(m)},"status":"final"}`,
    expectCode: "RESOURCE_NOT_MODELED",
  },
  {
    // An element name on a resource the validator has a schema for, the only configuration in
    // which an unrecognised name draws a finding naming it.
    name: "Patient.<property name> (unknown element)",
    plant: (m) => patientWith(`${JSON.stringify(m)}:"x"`),
    expectCode: "UNKNOWN_ELEMENT",
  },
  {
    // A repeated property name. The reader reports the element, so the name is in the location.
    name: "Patient.<property name> (repeated name)",
    plant: (m) => patientWith(`${JSON.stringify(m)}:"x",${JSON.stringify(m)}:"y"`),
    expectCode: "DUPLICATE_PROPERTY",
  },
  {
    // An array inside an array under a document-named element, at the root.
    name: "Patient.<property name> (array inside an array)",
    plant: (m) => patientWith(`${JSON.stringify(m)}:[["x"]]`),
    expectCode: "NESTED_ARRAY",
  },
  {
    // The same one level down, so the bound has to hold on a segment that is not the last.
    name: "Patient.<property name>.<property name> (nested, array inside an array)",
    plant: (m) => patientWith(`${JSON.stringify(m)}:{${JSON.stringify(m)}:[["x"]]}`),
    expectCode: "NESTED_ARRAY",
  },
  {
    // A member of a primitive's `_`-sibling that is neither `id` nor `extension`.
    name: "Patient.gender._<member name> (unrecognised primitive metadata)",
    plant: (m) => patientWith(`"_gender":{${JSON.stringify(m)}:"x"}`),
    expectCode: "UNKNOWN_PROPERTY",
  },
  {
    // A reference reached THROUGH a document-named element inside a Bundle, so the name is a
    // middle segment of a location built by a different walker from the two above.
    name: "Bundle.entry[0].resource.<property name>.reference (unresolved reference)",
    plant: (m) =>
      `{"resourceType":"Bundle","type":"collection","entry":[{"resource":` +
      `{"resourceType":"Patient",${JSON.stringify(m)}:{"reference":"Patient/absent"}}}]}`,
    expectCode: "REFERENCE_UNRESOLVED",
  },
  {
    // The root again, through a second document shape (a CodeableConcept-bearing resource rather
    // than a bare status). It does NOT reach the terminology layer's own `rootPath` call: that one
    // is only observable once a binding matched, which requires a real FHIR type. So this is a
    // twelfth position exercised by a thirteenth slot, not a thirteenth position.
    name: "$.resourceType (the expression root, second document shape)",
    plant: (m) =>
      `{"resourceType":${JSON.stringify(m)},` +
      `"code":{"coding":[{"system":"http://example.org/x","code":"y"}]}}`,
    expectCode: "RESOURCE_NOT_MODELED",
  },
  {
    // A document-named element carrying a modifierExtension this library cannot honour, on a
    // safety resource type, which is the fail-closed path.
    name: "Observation.<property name>.modifierExtension (fail-closed modifier)",
    plant: (m) =>
      `{"resourceType":"Observation","status":"final",${JSON.stringify(m)}:` +
      `{"modifierExtension":[{"url":"http://example.org/unknown"}]}}`,
    expectCode: "UNHANDLED_MODIFIER_EXTENSION",
  },
];

describe("no document-supplied name reaches a JSON diagnostic unbounded", () => {
  for (const slot of JSON_SLOTS) {
    it(`holds for ${slot.name}`, () => {
      assertNoDiagnosticPhiLeak<string, Surfaces>({
        slots: [slot],
        parse: (raw: string) => runJson(raw, "lenient"),
        parseStrict: (raw: string) => runJson(raw, "strict"),
        getDiagnostics: (s) => s.diagnostics,
        getModelIdentifiers: (s) => s.identifiers,
      });
    });
  }
});

const XML_SLOTS: readonly DiagnosticSlot<string>[] = [
  {
    // The root element name is the XML spelling of `resourceType`, so it is the same root.
    name: "<root> element name (the expression root)",
    plant: (m) => `<${m} xmlns="http://example.org/not-fhir"><status value="final"/></${m}>`,
    expectCode: "UNEXPECTED_XML_CONTENT",
  },
  {
    // A child element beside a `value` attribute: the reader treats the parent as a primitive
    // and flags the stray by name.
    name: "<element> child name on a primitive (stray child)",
    plant: (m) => `<Patient xmlns="${FHIR_NS}"><gender value="male"><${m}/></gender></Patient>`,
    expectCode: "UNKNOWN_PROPERTY",
  },
  {
    // An attribute the reader does not model, on a complex element.
    name: "<element attribute-name> (unknown attribute)",
    plant: (m) => `<Patient xmlns="${FHIR_NS}"><name ${m}="x"><family value="y"/></name></Patient>`,
    expectCode: "UNKNOWN_PROPERTY",
  },
  {
    // The same on a primitive element, which takes the other of the reader's two branches.
    name: "<primitive attribute-name> (unknown attribute on a primitive)",
    plant: (m) => `<Patient xmlns="${FHIR_NS}"><gender value="male" ${m}="x"/></Patient>`,
    expectCode: "UNKNOWN_PROPERTY",
  },
];

describe("no document-supplied name reaches an XML diagnostic unbounded", () => {
  for (const slot of XML_SLOTS) {
    it(`holds for ${slot.name}`, () => {
      assertNoDiagnosticPhiLeak<string, Surfaces>({
        slots: [slot],
        parse: (raw: string) => runXml(raw, "lenient"),
        parseStrict: (raw: string) => runXml(raw, "strict"),
        getDiagnostics: (s) => s.diagnostics,
        getModelIdentifiers: (s) => s.identifiers,
      });
    });
  }
});
