import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  complex,
  FhirSerializeError,
  ISSUE_CODES,
  parseResource,
  parseResourceXml,
  primitive,
  readSafety,
  SERIALIZE_ERROR_CODES,
  serializeResource,
  serializeResourceXml,
  validateResource,
  type FhirComplex,
} from "../src/index.js";

/**
 * `JSON -> XML -> JSON` laundered, because XML has no `null`.
 *
 * The JSON reader marks four positions FHIR JSON gives no meaning to and keeps what the sender wrote
 * at them, so `serializeResource` hands it back and re-reading the output reproduces the finding: an
 * array inside an array, a scalar or `null` where FHIR JSON has an object, that same shape in a
 * primitive's `_`-sibling, and a `null` in a primitive's value channel that padded nothing.
 *
 * XML has no array of arrays, no `_`-sibling and no `null`, so `serializeResourceXml` had nothing to
 * hand back and emitted the node the reader was left holding: an empty element, or none at all. That
 * output re-reads with an **empty issue list**, so the finding was gone after one trip and the shape
 * was erased. Three of the four also re-read `valid: true`; the fourth is the row below whose
 * `reReadValid` is `false`. `{"value":null,"unit":"mg"}` came back as a `Quantity`
 * carrying a unit and no magnitude; `{"name":[[{"family":"Roe"}]]}` came back with the name gone and
 * `safeToSummarize` flipped from `false` to `true`.
 *
 * Both halves are asserted in every case here, because neither closes it alone: the refusal, **and**
 * the document base used to emit re-read to show what the refusal is instead of. The bytes base
 * emitted are asserted through `parseResourceXml`, so this suite records the laundering rather than
 * describing it.
 *
 * **What this is NOT.** It is not a claim that the XML writer is lossless, or that every finding
 * survives a format change. An array-wrapped `0..1` element still launders across this boundary and
 * is pinned in `array-wrapped-scalar.test.ts`; a repeated property name is dropped by **both**
 * writers; a JSON decimal comes back from XML as a string, because XML carries no JSON type. None of
 * those is a marked node, and none is closed here.
 *
 * Every value here is synthetic.
 */

/** The `FhirSerializeError` the XML writer raises for `node`, or `undefined` if it emits. */
function refusal(node: FhirComplex): FhirSerializeError | undefined {
  try {
    serializeResourceXml(node);
  } catch (error) {
    if (error instanceof FhirSerializeError) return error;
    throw error;
  }
  return undefined;
}

/** Parse JSON, and report the codes and the refusal in one go. */
function fromJson(input: string): {
  resource: FhirComplex;
  codes: string[];
  refused: FhirSerializeError | undefined;
} {
  const { resource, issues } = parseResource(input);
  return { resource, codes: issues.map((issue) => issue.code), refused: refusal(resource) };
}

/** Load a fixture as its exact text (fixtures carry no trailing newline). */
function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

describe("the four marked shapes are refused rather than emitted as an empty element", () => {
  /**
   * One row per marker, each a shape this library records as a real harm rather than an exotic
   * input, with the location the refusal must name and the bytes base emitted for it.
   */
  const CASES = [
    {
      what: "a `null` in a primitive's value channel that padded nothing",
      json: '{"resourceType":"Observation","status":"final","valueQuantity":{"value":null,"unit":"mg"}}',
      code: ISSUE_CODES.UNDEFINED_JSON_NULL,
      at: "Observation.valueQuantity.value",
      base: '<Observation xmlns="http://hl7.org/fhir"><status value="final"/><valueQuantity><value/><unit value="mg"/></valueQuantity></Observation>',
      // The magnitude is gone and the unit survives: a quantity that reads as a bare unit rather
      // than as missing, which is the shape the value-channel rule exists for.
      reReadJson: '{"resourceType":"Observation","status":"final","valueQuantity":{"unit":"mg"}}',
      reReadValid: true,
    },
    {
      what: "a scalar in a primitive's `_`-sibling",
      json: '{"resourceType":"Observation","status":"final","_status":"x"}',
      code: ISSUE_CODES.UNKNOWN_PROPERTY,
      at: "Observation.status",
      base: '<Observation xmlns="http://hl7.org/fhir"><status value="final"/></Observation>',
      reReadJson: '{"resourceType":"Observation","status":"final"}',
      reReadValid: true,
    },
    {
      what: "a scalar where FHIR JSON has an object",
      json: '{"resourceType":"AllergyIntolerance","clinicalStatus":{"coding":[{"code":"active"},"junk"]}}',
      code: ISSUE_CODES.UNKNOWN_PROPERTY,
      at: "AllergyIntolerance.clinicalStatus.coding[1]",
      base: '<AllergyIntolerance xmlns="http://hl7.org/fhir"><clinicalStatus><coding><code value="active"/></coding><coding/></clinicalStatus></AllergyIntolerance>',
      reReadJson:
        '{"resourceType":"AllergyIntolerance","clinicalStatus":{"coding":[{"code":"active"},null]}}',
      reReadValid: true,
    },
    {
      what: "an array inside an array",
      json: '{"resourceType":"Patient","name":[[{"family":"Roe"}]]}',
      code: ISSUE_CODES.NESTED_ARRAY,
      at: "Patient.name[0]",
      base: '<Patient xmlns="http://hl7.org/fhir"><name/></Patient>',
      reReadJson: '{"resourceType":"Patient"}',
      // The one row whose emitted document does not re-read fully clean, and NOT because it is
      // empty or because it repeats: `<coding/>` in the row above is both and re-reads `valid: true`.
      // `<name/>` re-reads as a value-absent primitive where the schema types a complex datatype, so
      // the validator draws TYPE_MISMATCH. `issues` is still empty and `safeToSummarize` still flips,
      // so the finding is still gone either way.
      reReadValid: false,
    },
  ] as const;

  it.each(CASES)("refuses $what", ({ json, code, at }) => {
    const { codes, refused } = fromJson(json);
    expect(codes).toContain(code);
    expect(refused).toBeInstanceOf(FhirSerializeError);
    expect(refused).toMatchObject({
      code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE,
      locations: [at],
    });
  });

  it.each(CASES)(
    "records what base emitted for $what, and how it re-read",
    ({ base, reReadJson, reReadValid }) => {
      // This is the laundering itself, asserted rather than described: the document base put on the
      // wire carries no finding at all when it comes back, so a consumer re-reading it cannot tell it
      // apart from one whose sender wrote the conformant thing.
      const back = parseResourceXml(base);
      expect(back.issues).toEqual([]);
      expect(validateResource(back.resource).valid).toBe(reReadValid);
      expect(serializeResource(back.resource)).toBe(reReadJson);
    },
  );

  it.each(CASES)("leaves the JSON route open for $what, reproducing the finding", ({ json }) => {
    // The capability is routed, not lost: `serializeResource` writes every one of these back and
    // re-reading that output reproduces the finding. These four inputs happen to carry no JSON
    // escape, so they also come back byte-identical -- which is NOT the general property, and the
    // test below is the failing example that stops this one being read as one.
    const { resource, codes } = fromJson(json);
    expect(serializeResource(resource)).toBe(json);
    expect(parseResource(serializeResource(resource)).issues.map((i) => i.code)).toEqual(codes);
  });

  it("hands the text back VALUE-exact, not BYTE-exact, which the four rows above do not show", () => {
    // The preserved text is the value re-rendered the way this library renders every JSON value, so
    // an escape the sender chose does not survive. `Practitioner\/2` is not exotic: escaping `/` is
    // what PHP's `json_encode` does by default. Same string, different bytes, and a caller diffing
    // the writer's output against its input sees it. Stated on `FhirComplex.nonObjectSource` too.
    const input =
      '{"resourceType":"Observation","status":"final","performer":[{"reference":"Practitioner/1"},"Practitioner\\/2"]}';
    const { resource, refused } = fromJson(input);
    expect(refused).toMatchObject({
      code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE,
      locations: ["Observation.performer[1]"],
    });
    const out = serializeResource(resource);
    expect(out).not.toBe(input);
    expect(out).toBe(
      '{"resourceType":"Observation","status":"final","performer":[{"reference":"Practitioner/1"},"Practitioner/2"]}',
    );
    // Value-exact is the half that matters: the finding comes back and the string denotes the same.
    expect(parseResource(out).issues.map((i) => i.code)).toEqual([ISSUE_CODES.UNKNOWN_PROPERTY]);
  });

  it("says only what the refusal does not reach, never that the JSON writer keeps the shape", () => {
    // The one input where neither writer carries it: a marker inside a member a repeated property
    // name shadowed. A message promising `serializeResource` writes it back would point an operator
    // at a route that silently drops it, so the message names the refusal's own limit instead.
    const { resource, refused } = fromJson(
      '{"resourceType":"Patient","name":[{"family":"Roe"}],"name":[[{"family":"Roe"}]]}',
    );
    expect(refused?.message).toContain("this refusal does not reach serializeResource");
    expect(refused?.message).not.toContain("writes it back");
    // And the drop it must not promise against, asserted rather than described.
    expect(serializeResource(resource)).toBe(
      '{"resourceType":"Patient","name":[{"family":"Roe"}]}',
    );
  });

  it("turns a refusal to summarize into an affirmation, which is why an array inside an array is here", () => {
    const { resource } = parseResource('{"resourceType":"Patient","name":[[{"family":"Roe"}]]}');
    expect(readSafety(resource).safeToSummarize).toBe(false);
    const laundered = parseResourceXml('<Patient xmlns="http://hl7.org/fhir"><name/></Patient>');
    expect(readSafety(laundered.resource).safeToSummarize).toBe(true);
  });

  it("reaches a dose magnitude's own metadata channel three levels down", () => {
    // Depth is not a special case, but this is the position where the harm is clinical: the channel
    // belongs to the number in `MedicationRequest.dosageInstruction[].doseAndRate[].doseQuantity`.
    const { refused } = fromJson(
      '{"resourceType":"MedicationRequest","status":"active","intent":"order","dosageInstruction":[{"doseAndRate":[{"doseQuantity":{"value":5,"_value":"junk","unit":"mg"}}]}]}',
    );
    expect(refused).toMatchObject({
      code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE,
      locations: ["MedicationRequest.dosageInstruction[0].doseAndRate[0].doseQuantity.value"],
    });
  });

  it("reaches a marker inside a member a repeated property name shadowed", () => {
    // Wider than the XML writer's own walk, which visits `properties` only. The shared collector
    // visits the shadowed member too, so a marked node cannot be hidden behind a duplicate key.
    const { refused } = fromJson(
      '{"resourceType":"Patient","name":[{"family":"Roe"}],"name":[[{"family":"Roe"}]]}',
    );
    expect(refused).toMatchObject({
      code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE,
      locations: ["Patient.name[0]"],
    });
  });

  it("reaches a marker on a `div`, the one branch that writes a value as markup", () => {
    // `writeItem`'s `div` branch returns before the primitive is written, so a site-local check
    // there would have to be repeated. The refusal is a walk of the whole model instead, and the
    // answer does not depend on which position the writer would have put the node in.
    const { refused } = fromJson(
      '{"resourceType":"Patient","text":{"status":"generated","div":"<div xmlns=\\"http://www.w3.org/1999/xhtml\\">ok</div>","_div":null}}',
    );
    expect(refused).toMatchObject({
      code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE,
      locations: ["Patient.text.div"],
    });
  });

  it("names the location and never the content, which can itself be a forgery", () => {
    const { refused } = fromJson(
      '{"resourceType":"Observation","status":"final","_status":"716186003 no known allergy"}',
    );
    expect(JSON.stringify(refused?.locations)).not.toContain("716186003");
    expect(refused?.message).not.toContain("716186003");
    expect(refused?.locations).toEqual(["Observation.status"]);
  });
});

describe("nothing that works is withdrawn, asserted in both polarities", () => {
  const CONFORMANT = [
    [
      "§2.6.2.3 padding",
      '{"resourceType":"Patient","name":[{"given":["a","b"],"_given":[null,{"id":"q"}]}]}',
    ],
    [
      "a value-absent singleton",
      '{"resourceType":"Observation","status":"final","_issued":{"id":"q1"}}',
    ],
    [
      "a primitive extension",
      '{"resourceType":"Patient","birthDate":"1980-01-01","_birthDate":{"extension":[{"url":"http://example.org/x","valueString":"s"}]}}',
    ],
    [
      "a precision-critical decimal",
      '{"resourceType":"Observation","status":"final","valueQuantity":{"value":0.010,"unit":"mg"}}',
    ],
  ] as const;

  it.each(CONFORMANT)("still serializes %s to XML", (_label, json) => {
    const { refused } = fromJson(json);
    expect(refused).toBeUndefined();
  });

  it("is marked by the JSON reader alone, which is why no XML document can reach the refusal", () => {
    // The corpus sweep below is 7 fixtures; this is the mechanical half, and it is the one that
    // generalises. A census over every file under `src/`: the markers are set through the reader's
    // own helpers, and nothing in the XML path sets one. A new setter anywhere else reds this.
    const src = new URL("../src/", import.meta.url).pathname;
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(`${dir}${entry.name}/`)
          : entry.name.endsWith(".ts")
            ? [`${dir}${entry.name}`.slice(src.length)]
            : [],
      );
    const referencing = (pattern: RegExp): string[] =>
      files(src)
        .filter((name) => pattern.test(readFileSync(`${src}${name}`, "utf8")))
        .sort();
    expect(referencing(/markUndefinedNull|markNonObjectMeta|markNestedArray/)).toEqual([
      "codec/read.ts", // calls them
      "model/node.ts", // declares them
    ]);
    // `nonObjectSource` is set by a literal rather than a helper, so the census is over the
    // assignment. Reads of it (`node.nonObjectSource !== undefined`) do not match.
    expect(referencing(/nonObjectSource\s*:/)).toEqual(["codec/read.ts"]);
  });

  it("never refuses a document read from XML, over the whole XML fixture corpus", () => {
    // The markers are set by the JSON reader alone: XML cannot write any of these shapes, so no
    // document that arrived through `parseResourceXml` carries one. Asserted over the corpus rather
    // than argued from the reader's source.
    const xmlFixtures = readdirSync(new URL("./__fixtures__/", import.meta.url)).filter((name) =>
      name.endsWith(".xml"),
    );
    expect(xmlFixtures.length).toBeGreaterThan(0);
    for (const name of xmlFixtures) {
      const source = fixture(name);
      const { resource } = parseResourceXml(source);
      expect(refusal(resource), name).toBeUndefined();
      expect(serializeResourceXml(resource), name).toBe(source);
    }
  });

  it("refuses exactly the JSON fixtures that carry a marker, and no others", () => {
    // A census over every JSON fixture, derived each run rather than written down, and asserted in
    // both directions: which ones refuse, and that the rest still emit. The corpus is this repo's
    // hand-authored fixtures, not the FHIR R4 published-examples corpus.
    const refused: string[] = [];
    const emitted: string[] = [];
    const unreadable: string[] = [];
    for (const name of readdirSync(new URL("./__fixtures__/", import.meta.url)).filter((f) =>
      f.endsWith(".json"),
    )) {
      let resource;
      try {
        resource = parseResource(fixture(name)).resource;
      } catch {
        // A fatal read never reaches a writer at all, so it is neither refused nor emitted. Recorded
        // rather than skipped silently: a census that quietly drops a row is how a zero goes wrong.
        unreadable.push(name);
        continue;
      }
      (refusal(resource)?.code === SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE
        ? refused
        : emitted
      ).push(name);
    }
    expect(refused).toEqual([]);
    expect(unreadable).toEqual(["quirk-primitive-extension-misaligned.json"]);
    expect(emitted.length).toBeGreaterThan(0);
  });
});

describe("every disjunct of the predicate is pinned on its own", () => {
  /**
   * The four rows above go through the reader, which sets more than one field at a time: it always
   * sets `nestedArray` beside `nestedArraySource`, so a suite built only from documents leaves each
   * of those clauses individually deletable while staying green. These build the node directly, one
   * field at a time, which is also the "node built by hand" case the predicate's docblock names.
   */
  const ONE_FIELD = [
    ["nestedArray, the marker with no text", { ...primitive("x"), nestedArray: true } as const],
    [
      "nestedArraySource, the text with no marker",
      { ...primitive("x"), nestedArraySource: '[["a"]]' } as const,
    ],
    [
      "nestedArrayMetaSource, the `_`-sibling channel",
      { ...primitive("x"), nestedArrayMetaSource: '[["a"]]' } as const,
    ],
    ["nonObjectMetaSource", { ...primitive("x"), nonObjectMetaSource: '"x"' } as const],
    ["undefinedNull", { ...primitive(undefined), undefinedNull: true } as const],
  ] as const;

  it.each(ONE_FIELD)("refuses a primitive carrying only %s", (_label, node) => {
    const resource = complex([
      { name: "resourceType", value: primitive("Observation") },
      { name: "issued", value: node },
    ]);
    expect(refusal(resource)).toMatchObject({
      code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE,
      locations: ["Observation.issued"],
    });
  });

  it.each([
    ["nestedArray", { ...complex([]), nestedArray: true } as const],
    ["nestedArraySource", { ...complex([]), nestedArraySource: "[[1]]" } as const],
    ["nonObjectSource", { ...complex([]), nonObjectSource: '"x"' } as const],
  ] as const)("refuses a complex carrying only %s", (_label, node) => {
    const resource = complex([
      { name: "resourceType", value: primitive("Observation") },
      { name: "subject", value: node },
    ]);
    expect(refusal(resource)).toMatchObject({
      code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE,
      locations: ["Observation.subject"],
    });
  });

  it("emits the same model with none of them set, so each row above is the field and not the shape", () => {
    // The negative pole. Without it every row above would pass for a writer that refused everything.
    const resource = complex([
      { name: "resourceType", value: primitive("Observation") },
      { name: "issued", value: primitive("x") },
      { name: "subject", value: complex([]) },
    ]);
    expect(refusal(resource)).toBeUndefined();
  });
});

describe("no case moves onto the new code", () => {
  it("keeps the name refusal for a model that trips both", () => {
    const { resource } = parseResource(
      '{"resourceType":"Observation","zz value=\\"1\\"/><status":1,"issued":null}',
    );
    expect(refusal(resource)).toMatchObject({
      code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME,
    });
  });

  it("keeps the div refusal for a model that trips both", () => {
    const { resource } = parseResource(
      '{"resourceType":"Patient","text":{"div":"<div/><code/>"},"issued":null}',
    );
    expect(refusal(resource)).toMatchObject({
      code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_DIV_MARKUP,
    });
  });

  it("keeps the dropped-text refusal, which is the XML reader's own marker and not one of these", () => {
    const { resource } = parseResourceXml(
      '<Observation xmlns="http://hl7.org/fhir"><status>entered-in-error</status></Observation>',
    );
    expect(refusal(resource)).toMatchObject({
      code: SERIALIZE_ERROR_CODES.DROPPED_ELEMENT_TEXT,
    });
  });

  it("keeps the dropped-text refusal for a model carrying BOTH markers, which needs a hand-built node", () => {
    // The row above does NOT pin this ordering: its model comes from `parseResourceXml`, which sets
    // no JSON-only marker, so moving the new refusal ahead of `assertSerializable` leaves it green.
    // No document can carry both (one marker is XML's, the others are JSON's), so the ordering is
    // only reachable by building the node, which is exactly why it was unpinned and is pinned here.
    const resource = complex([
      { name: "resourceType", value: primitive("Observation") },
      { name: "status", value: { ...primitive(undefined), droppedText: true } },
      { name: "issued", value: { ...primitive(undefined), undefinedNull: true } },
    ]);
    expect(refusal(resource)).toMatchObject({
      code: SERIALIZE_ERROR_CODES.DROPPED_ELEMENT_TEXT,
    });
  });
});

describe("what is deliberately NOT closed here, pinned so it cannot be read as covered", () => {
  it("an array-wrapped `0..1` element still launders across the format boundary", () => {
    // No node is marked: the model holds a genuine list of one, and XML spells a repeating element
    // by repeating it, so one occurrence is exactly what comes back. Closing it would need a
    // cardinality decision on the write path, which is a different change. Its own suite owns it.
    const { resource, refused } = fromJson(
      '{"resourceType":"Observation","status":["entered-in-error"]}',
    );
    expect(refused).toBeUndefined();
    expect(readSafety(resource).safeToSummarize).toBe(false);
    const back = parseResourceXml(serializeResourceXml(resource));
    expect(readSafety(back.resource).safeToSummarize).toBe(true);
  });

  it("a repeated property name is still dropped, by BOTH writers rather than by this one", () => {
    // Not this class: the JSON writer drops it too (one member per name, declared), so there is no
    // hand-back for XML to be missing. `DUPLICATE_PROPERTY` and the safety refusal carry it instead.
    const { resource, refused } = fromJson(
      '{"resourceType":"Observation","status":"final","status":"entered-in-error"}',
    );
    expect(refused).toBeUndefined();
    expect(serializeResource(resource)).toBe('{"resourceType":"Observation","status":"final"}');
    expect(readSafety(resource).safeToSummarize).toBe(false);
  });

  it("a JSON decimal still comes back from XML as a string, because XML carries no JSON type", () => {
    // Pre-existing and unrelated to any marker: the lexical value survives byte-exact, the JSON type
    // does not, and the information-severity precision finding is not reproduced on the re-read.
    const { resource, refused } = fromJson(
      '{"resourceType":"Observation","status":"final","valueQuantity":{"value":0.010,"unit":"mg"}}',
    );
    expect(refused).toBeUndefined();
    const back = parseResourceXml(serializeResourceXml(resource));
    expect(serializeResource(back.resource)).toBe(
      '{"resourceType":"Observation","status":"final","valueQuantity":{"value":"0.010","unit":"mg"}}',
    );
  });
});
