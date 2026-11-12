import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { rawJsonText } from "../src/codec/raw-json.js";
import {
  FhirCodecError,
  FhirSerializeError,
  getProperty,
  isComplex,
  isList,
  parseResource,
  readRawJson,
  readSafety,
  serializeResource,
  type FhirIssue,
  type FhirNode,
  type ReadResult,
} from "../src/index.js";
import { propertyRun } from "./_property-run.js";

/**
 * An array that mixes objects with scalars, `null`s or arrays.
 *
 * FHIR JSON uses an array for a repeating element of one type, so a mixed array is not a shape the
 * spec defines, and the reader keeps it leniently. The defect this file pins: an object that came
 * AFTER a scalar was read into a repeating primitive, where an object has no value, so its content
 * was dropped with only an `UNKNOWN_PROPERTY` warning that did not say so, and the writer emitted
 * `null` in its place. The same object written FIRST was read as an element and kept. Order decided
 * whether content survived.
 *
 * Every read here runs twice: from text, and from a tree `readRawJson` made of the same text. The
 * two take different routes through the reader, and both must give the same model and issues.
 *
 * All values here are synthetic.
 */

/** The reported document. */
const REPORTED =
  '{"resourceType":"Patient","extension":["x",{"url":"http://example.com/syn-ext","valueString":"syn"}]}';

/** Both read paths of one document, each with its own fresh input. */
function readBoth(text: string): readonly [ReadResult, ReadResult] {
  return [parseResource(text), parseResource(readRawJson(text))];
}

/** `text` with each JSON value rendered the one way this library renders it, for value-exact compare. */
function canonical(text: string): string {
  return rawJsonText(readRawJson(text));
}

function codes(issues: readonly FhirIssue[]): string[] {
  return issues.map((issue) => `${issue.code} at ${issue.expression ?? ""}`);
}

function items(node: FhirNode | undefined): readonly FhirNode[] {
  if (node === undefined || !isList(node)) throw new Error("expected a list");
  return node.items;
}

describe("an object after a scalar in one array", () => {
  it("keeps the object as an element on both read paths", () => {
    for (const { resource, issues } of readBoth(REPORTED)) {
      const second = items(getProperty(resource, "extension"))[1];
      expect(second !== undefined && isComplex(second)).toBe(true);
      if (second === undefined || !isComplex(second)) return;
      expect(second.properties.map((p) => p.name)).toEqual(["url", "valueString"]);
      // The string the sender wrote first is the shape the element cannot hold: that position, and
      // only that one, is reported.
      expect(codes(issues)).toEqual(["UNKNOWN_PROPERTY at Patient.extension[0]"]);
    }
  });

  it("round-trips the document as written on both read paths", () => {
    for (const { resource } of readBoth(REPORTED)) {
      expect(serializeResource(resource)).toBe(REPORTED);
    }
  });

  it("reads the same no matter which member comes first", () => {
    const reversed =
      '{"resourceType":"Patient","extension":[{"url":"http://example.com/syn-ext","valueString":"syn"},"x"]}';
    const [forward] = readBoth(REPORTED);
    const [backward] = readBoth(reversed);
    const objectOf = (result: ReadResult, at: number): FhirNode | undefined =>
      items(getProperty(result.resource, "extension"))[at];
    expect(objectOf(forward, 1)).toEqual(objectOf(backward, 0));
    expect(serializeResource(backward.resource)).toBe(reversed);
  });

  it("keeps an object among strings the text read first scans as a plain array", () => {
    // The text read builds an array of only strings and booleans straight from its tokens; one
    // object among them sends the whole array to the tree reader, which keeps it.
    const json =
      '{"resourceType":"Patient","extension":["a","b",{"url":"http://example.com/syn-ext","valueString":"syn"},"c"]}';
    for (const { resource, issues } of readBoth(json)) {
      const third = items(getProperty(resource, "extension"))[2];
      expect(third !== undefined && isComplex(third)).toBe(true);
      if (third === undefined || !isComplex(third)) return;
      expect(third.properties.map((p) => p.name)).toEqual(["url", "valueString"]);
      expect(codes(issues)).toEqual([
        "UNKNOWN_PROPERTY at Patient.extension[0]",
        "UNKNOWN_PROPERTY at Patient.extension[1]",
        "UNKNOWN_PROPERTY at Patient.extension[3]",
      ]);
      expect(serializeResource(resource)).toBe(json);
      expect(readSafety(resource).notAssessed).toEqual([
        "Patient.extension[0]",
        "Patient.extension[1]",
        "Patient.extension[3]",
      ]);
    }
  });

  it("lets the safety readout reach a modifier inside the object", () => {
    const json = '{"resourceType":"Practitioner","identifier":["x",{"use":"old"}]}';
    for (const { resource } of readBoth(json)) {
      expect(readSafety(resource).modifierElements).toEqual([
        { element: "use", location: "Practitioner.identifier[1].use" },
      ]);
      expect(readSafety(resource).safeToSummarize).toBe(false);
    }
  });
});

describe("a scalar or null beside an object in one array", () => {
  // The scalar is held as an empty element carrying its text. A caller reading that text would read
  // it as the element the definitions put there, which it is not, so the readout declines it,
  // whichever member comes first.
  const cases: readonly (readonly [string, string])[] = [
    ['["x",{"system":"urn:example:syn"}]', "Practitioner.identifier[0]"],
    ['[{"system":"urn:example:syn"},"x"]', "Practitioner.identifier[1]"],
    ['[{"system":"urn:example:syn"},null]', "Practitioner.identifier[1]"],
    ['[{"system":"urn:example:syn"},1.5]', "Practitioner.identifier[1]"],
  ];
  for (const [array, location] of cases) {
    it(`is not assessed at ${location} in ${array}`, () => {
      const json = `{"resourceType":"Practitioner","identifier":${array}}`;
      for (const { resource } of readBoth(json)) {
        const safety = readSafety(resource);
        expect(safety.notAssessed).toEqual([location]);
        expect(safety.safeToSummarize).toBe(false);
      }
    });
  }

  it("is declined once, at the element, under an element the definitions do not describe", () => {
    // Nothing under an undefined element is checked against the definitions, so the scalar inside
    // it is not listed again on its own.
    const json = '{"resourceType":"Patient","zz":["x",{"a":"syn"},null]}';
    for (const { resource } of readBoth(json)) {
      const safety = readSafety(resource);
      expect(safety.notAssessed).toEqual(["Patient.zz"]);
      expect(safety.safeToSummarize).toBe(false);
    }
  });
});

/** A synthetic scalar as JSON text: a string, a number written several ways, a boolean. */
const scalarText = fc.oneof(
  fc.stringMatching(/^[a-z]{0,6}$/).map((s) => JSON.stringify(s)),
  fc.constantFrom("0", "-1", "1.50", "0.010", "1e3", "12345678901234567890"),
  fc.constantFrom("true", "false"),
);

/** A synthetic object as JSON text, with unique plain keys and scalar, `null` or small array values. */
const objectText = fc
  .uniqueArray(
    fc.tuple(
      fc.stringMatching(/^[a-z]{1,6}$/),
      fc.oneof(
        scalarText,
        fc.constant("null"),
        fc.array(scalarText, { minLength: 1, maxLength: 3 }).map((a) => `[${a.join(",")}]`),
      ),
    ),
    { selector: ([key]) => key, maxLength: 4 },
  )
  .map((members) => `{${members.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(",")}}`);

/** A member of a mixed array: a scalar, an object, a `null`, or an array (nested, possibly empty). */
const memberText = fc.letrec((tie) => ({
  member: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    scalarText,
    objectText,
    fc.constant("null"),
    tie("nested"),
  ),
  nested: fc.array(tie("member"), { maxLength: 3 }).map((a) => `[${(a as string[]).join(",")}]`),
})).member as fc.Arbitrary<string>;

/**
 * A `_`-sibling's member: `null`, or an object of the `id` and `extension` a primitive carries. At
 * least one member is an object, so the sibling carries something a write could lose.
 */
const siblingMemberText = fc.oneof(
  fc.constant("null"),
  fc.stringMatching(/^[a-z]{1,4}$/).map((id) => `{"id":"syn-${id}"}`),
  fc.constant('{"extension":[{"url":"http://example.com/syn-ext","valueString":"syn"}]}'),
);

/**
 * A mixed array, and maybe a `_`-sibling beside it: mostly as long as the array, as FHIR pairs
 * them, sometimes not.
 */
const propertyText = fc.array(memberText, { minLength: 1, maxLength: 6 }).chain((values) =>
  fc.tuple(
    fc.constant(values),
    fc.option(
      fc
        .oneof(
          { arbitrary: fc.constant(values.length), weight: 3 },
          { arbitrary: fc.integer({ min: 1, max: 6 }), weight: 1 },
        )
        .chain((length) =>
          fc
            .array(siblingMemberText, { minLength: length, maxLength: length })
            .filter((members) => members.some((member) => member !== "null")),
        ),
      { nil: undefined },
    ),
  ),
);

/**
 * One property as members of the resource: the value array, then its `_`-sibling when there is one.
 * With `bare`, a value array of only `null`s beside a kept sibling is left out. It carries no value,
 * and the sibling alone says the list is value-absent, so a write may give it back either way.
 */
function propertyMembers(
  name: string,
  [values, sibling]: readonly [readonly string[], readonly string[] | undefined],
  withSibling: boolean,
  bare: boolean,
): string {
  const value = `"${name}":[${values.join(",")}]`;
  if (sibling === undefined || !withSibling) return value;
  const kept = `"_${name}":[${sibling.join(",")}]`;
  return bare && values.every((member) => member === "null") ? kept : `${value},${kept}`;
}

/**
 * A Patient whose `extension` (a real repeating element) and `zz` (no element) hold one mixed array
 * each, either one maybe with a `_`-sibling. `text()` is the document; `written(names)` is every
 * faithful write of it when the read discarded the siblings of `names` and said so. The writer
 * decides per property whether a `null`-only value array goes back, so each property may come back
 * bare or not on its own: `{"extension":[null],"_extension":[{...}],"zz":[null,null],...}` is
 * written with `extension` bare and `zz` kept, as the `null` in `zz` it marked as written is kept.
 */
const documentArbitrary = fc.tuple(propertyText, propertyText).map(([extension, zz]) => {
  const render = (dropped: ReadonlySet<string>, bare: ReadonlySet<string>): string =>
    `{"resourceType":"Patient",${propertyMembers("extension", extension, !dropped.has("extension"), bare.has("extension"))},${propertyMembers("zz", zz, !dropped.has("zz"), bare.has("zz"))}}`;
  const bareChoices: readonly ReadonlySet<string>[] = [
    new Set(),
    new Set(["extension"]),
    new Set(["zz"]),
    new Set(["extension", "zz"]),
  ];
  return {
    text: () => render(new Set(), new Set()),
    written: (dropped: ReadonlySet<string>) =>
      bareChoices.map((bare) => canonical(render(dropped, bare))),
  };
});

/** A read of `input`, or `undefined` when the reader refuses it plainly with a `FhirCodecError`. */
function readOrRefuse(input: Parameters<typeof parseResource>[0]): ReadResult | undefined {
  try {
    return parseResource(input);
  } catch (error) {
    expect(error).toBeInstanceOf(FhirCodecError);
    return undefined;
  }
}

describe("property: no member of a mixed array is lost silently", () => {
  it("both read paths agree, and the write hands back every member or refuses", () => {
    fc.assert(
      fc.property(documentArbitrary, (document) => {
        const text = document.text();
        const fromText = readOrRefuse(text);
        const fromTree = readOrRefuse(readRawJson(text));
        expect(fromTree === undefined).toBe(fromText === undefined);
        if (fromText === undefined || fromTree === undefined) return;
        expect(fromTree.resource).toEqual(fromText.resource);
        expect(codes(fromTree.issues)).toEqual(codes(fromText.issues));
        let written: string;
        try {
          written = serializeResource(fromText.resource);
        } catch (error) {
          // A refusal is plain, never a silent loss.
          expect(error).toBeInstanceOf(FhirSerializeError);
          return;
        }
        // A `_`-sibling the read discarded is named by a finding at its property; nothing else is
        // missing from the write.
        const dropped = new Set(
          fromText.issues
            .filter((issue) => issue.code === "MISPLACED_PRIMITIVE_EXTENSION")
            .map((issue) => (issue.expression ?? "").replace(/^Patient\./, "")),
        );
        expect(document.written(dropped)).toContain(canonical(written));
      }),
      propertyRun({ numRuns: 300 }),
    );
  });
});
