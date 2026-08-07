/**
 * A model name reaching an XML TAG position that XML cannot spell there.
 *
 * `serializeResourceXml` builds a start tag by interpolating a name the document supplied. FHIR
 * element names and resource type names are narrow, so for a conformant resource that is safe, but
 * the model is schema-free and the JSON reader admits any member name at all. Before this suite
 * existed the writer emitted whatever it was handed, and the interesting half of that is not the
 * markup that fails to parse: it is the markup that parses into DIFFERENT elements.
 *
 * The comparand throughout is **the same model through `serializeResource`**, the JSON writer, which
 * escapes a member name and encodes every one of these correctly. That is what makes the refusal a
 * refusal rather than a loss: the model is still writable, in the format that can express it.
 *
 * **What is deliberately NOT refused is asserted just as hard as what is.** A prefixed name with no
 * declaration to bind it, and a name that is not a conformant XML name, are both written verbatim
 * and both re-read through this library unchanged. Those are declared gaps, and the tests over them
 * are characterization tests: if you close one, they go red and you update them in the same change.
 *
 * **🔴 AND THE LAST BLOCK IN THIS FILE IS THE GAP THIS REFUSAL DOES NOT CLOSE, WHICH IS BIGGER THAN
 * THE ONE IT DOES.** A `div` property is emitted as raw markup, so it can carry whole elements into
 * the document. That is a fabrication route, it is `PRE-EXISTING`, and nothing here fixes it. It is
 * pinned so that the disclosure on `serializeResourceXml` is load-bearing rather than prose. **Do
 * not read this file as saying the writer cannot author an element.**
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  FhirSerializeError,
  SERIALIZE_ERROR_CODES,
  WITHHELD,
  parseResource,
  parseResourceXml,
  readSafety,
  serializeResource,
  serializeResourceXml,
  validateResource,
  type FhirComplex,
} from "../src/index.js";

const FHIR_NS = 'xmlns="http://hl7.org/fhir"';

/** Read a JSON resource, asserting nothing about it, and hand back the model. */
function model(json: string): FhirComplex {
  return parseResource(json).resource;
}

/** A one-property `Patient` whose single member is spelled `name`. */
function withName(name: string, value: unknown = "v"): FhirComplex {
  return model(JSON.stringify({ resourceType: "Patient", [name]: value }));
}

/** The `FhirSerializeError` `serializeResourceXml` throws for `node`, or `undefined`. */
function refusal(node: FhirComplex): FhirSerializeError | undefined {
  try {
    serializeResourceXml(node);
    return undefined;
  } catch (err) {
    if (err instanceof FhirSerializeError) return err;
    throw err;
  }
}

/**
 * Every name shape the writer must refuse, with the reason it cannot be written.
 *
 * The two groups are not the same harm and the difference is what decided the remedy. The first
 * group emits markup no parser reads back at all. The second emits markup a conformant parser
 * ACCEPTS, as a different set of elements than the model holds.
 */
const BREAKS_THE_TAG = [
  ["a space", "a b"],
  ["a tab", "a\tb"],
  ["a newline", "a\nb"],
  ["a carriage return", "a\rb"],
  ["an equals sign", "a=b"],
  ["a less-than sign", "a<b"],
  ["a greater-than sign", "a>b"],
  ["a solidus", "a/b"],
  ["an empty name", ""],
  ["a leading bang, which opens a markup declaration", "!ab"],
  ["a leading question mark, which opens a processing instruction", "?ab"],
] as const;

const FABRICATES_ELEMENTS = [
  ["a bare breakout", "x/><script"],
  ["a breakout that forges a clinical element", 'zz value="1"/><status'],
] as const;

/**
 * Every name shape the writer must KEEP writing, and the reason each one is a capability rather
 * than an oversight: this library's own round trip returns it unchanged.
 *
 * A conformant third-party parser rejects all of them. That is the declared gap, and it is not
 * closed here, because closing it means refusing a document that reads `valid: true` and writing it
 * back is something callers can do today.
 */
const DEFERRED_AND_STILL_WRITTEN = [
  ["a prefix nothing declares", "p:x"],
  ["a leading colon", ":x"],
  ["two colons", "a:b:c"],
  ["an ampersand", "a&b"],
  ["a leading digit", "1abc"],
  ["a leading hyphen", "-lead"],
  ["a leading full stop", ".lead"],
  ["a double quote", 'a"b'],
  ["an apostrophe", "a'b"],
  ["a vertical tab, which is not XML whitespace", "ab"],
  ["a form feed, which is not XML whitespace", "a\fb"],
  ["a non-breaking space, which is not XML whitespace", "a b"],
] as const;

describe("a model name at an XML tag position", () => {
  describe("the route that decided the remedy: markup that re-reads as DIFFERENT elements", () => {
    /**
     * THE HEADLINE, AND THE REASON THIS IS A REFUSAL RATHER THAN A REPORT.
     *
     * This document names no `status` anywhere. It reads with zero diagnostics and `valid: true`,
     * because a schema-free model has nothing to say about a member name. Written as XML by the
     * unguarded writer it became `<zz value="1"/><status value="final"/>`, which is well-formed,
     * which a conformant parser accepts, and which this library re-reads as an `Observation`
     * **whose status is `final`**. A clinical value present on neither side of the sender's
     * document, asserted by our own writer, under `valid: true` at both ends.
     */
    it("does not fabricate a status the document never named", () => {
      const forged = model(
        JSON.stringify({ resourceType: "Observation", 'zz value="1"/><status': "final" }),
      );
      // The reading itself is unremarkable, which is precisely the problem: nothing upstream of the
      // writer has any reason to object to this document.
      expect(parseResource(JSON.stringify({ resourceType: "Observation" })).issues).toEqual([]);
      expect(validateResource(forged).valid).toBe(true);
      expect(readSafety(forged).status).toBeUndefined();

      const err = refusal(forged);
      expect(err?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);

      // The capability is not lost, it is routed to the format that can express the name.
      expect(serializeResource(forged)).toBe(
        '{"resourceType":"Observation","zz value=\\"1\\"/><status":"final"}',
      );
    });

    it.each(FABRICATES_ELEMENTS)("refuses %s", (_label, name) => {
      expect(refusal(withName(name))?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
    });
  });

  describe("the rest of the refused set: markup that does not re-read at all", () => {
    it.each(BREAKS_THE_TAG)("refuses %s", (_label, name) => {
      expect(refusal(withName(name))?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
    });

    it("still writes every one of them as JSON, which escapes a member name", () => {
      for (const [, name] of [...BREAKS_THE_TAG, ...FABRICATES_ELEMENTS]) {
        const json = serializeResource(withName(name));
        // Round-trips through the format that can carry it, so nothing is unwritable.
        expect(parseResource(json).resource.properties.map((p) => p.name)).toEqual([
          "resourceType",
          name,
        ]);
      }
    });
  });

  /**
   * THE DECLARED GAP, PINNED AS THE BEHAVIOUR IT IS.
   *
   * Not a claim that writing these is right. A conformant parser rejects every one, so the output
   * is not portable, and that limit is stated on `serializeResourceXml`. What these assert is that
   * the refusal above did not quietly widen into them, because widening it would take away writing
   * back a document that reads `valid: true` and round-trips through this library today.
   *
   * **Characterization tests: closing this gap MUST red them, in the same change.**
   */
  describe("declared gap, still written: a name this library round-trips and XML does not admit", () => {
    it.each(DEFERRED_AND_STILL_WRITTEN)("writes %s verbatim", (_label, name) => {
      expect(refusal(withName(name))).toBeUndefined();
      const xml = serializeResourceXml(withName(name));
      expect(xml).toBe(`<Patient ${FHIR_NS}><${name} value="v"/></Patient>`);
      // And it comes back as the same one property, which is the capability being preserved.
      expect(parseResourceXml(xml).resource.properties.map((p) => p.name)).toEqual([
        "resourceType",
        name,
      ]);
    });

    /**
     * The named residual, unchanged: the binding a prefix needs is not in the model, so the writer
     * has nothing to declare it with, and the report that two vendor namespaces were involved does
     * not survive a write. Closing it means the model carrying the binding, which is a new model
     * capability, or refusing the shape, which is the capability withdrawal the test above forbids.
     */
    it("emits a prefixed foreign property with the prefix still unbound", () => {
      const doc =
        `<Observation ${FHIR_NS}><status value="final"/>` +
        `<v:x xmlns:v="urn:vendor" value="1"/></Observation>`;
      const { resource } = parseResourceXml(doc);
      const emitted = serializeResourceXml(resource);
      expect(emitted).toBe(
        `<Observation ${FHIR_NS}><status value="final"/><v:x value="1"/></Observation>`,
      );
      // Well-formed XML 1.0, not namespace-well-formed. This library reads it back; a conformant
      // parser does not.
      expect(parseResourceXml(emitted).resource.properties.map((p) => p.name)).toEqual([
        "resourceType",
        "status",
        "v:x",
      ]);
    });
  });

  describe("what the refusal reports", () => {
    /**
     * A refused name is document content, and one of the shapes it takes here is a forgery built to
     * look like markup. So the location must not echo it. That is not a new mechanism: every
     * location in this library is bounded by a published-name shape, and every name this refuses
     * fails that shape by construction, since the shape is far narrower than XML's. Asserted rather
     * than reasoned about, because it is the assertion that would notice if either shape moved.
     */
    it("never echoes the refused name, at a property position", () => {
      for (const [, name] of [...BREAKS_THE_TAG, ...FABRICATES_ELEMENTS]) {
        const err = refusal(withName(name));
        expect(err?.locations).toEqual([`Patient.${WITHHELD}`]);
        // The empty name is skipped: every string contains "", so the assertion would be vacuous.
        if (name !== "") expect(err?.message).not.toContain(name);
      }
    });

    /**
     * **The stronger sentence "every location renders `WITHHELD`" was written, and it is FALSE.** A
     * nested resource's type is reported at the location of the element WRAPPING it, so the refused
     * name never becomes a segment and there is nothing to withhold. What is asserted here is the
     * weaker and true property, which is also the one that carries the safety: it is echoed nowhere.
     */
    it("echoes nothing at a nested-resource position either, where there is no segment", () => {
      const bad = "O/><Patient";
      const err = refusal(
        model(JSON.stringify({ resourceType: "Patient", contained: [{ resourceType: bad }] })),
      );
      expect(err?.locations).toEqual(["Patient.contained[0]"]);
      expect(err?.locations.join("|")).not.toContain(bad);
      expect(err?.message).not.toContain(bad);
    });

    /**
     * Deduplicated, on the same reasoning the dropped-text refusal reports one location however
     * many marked nodes sit at it: a location is a POSITION. Here that bites harder than it does
     * there, because every refused name at one parent withholds to the same string, so `a b` and
     * `c=d` above are one location and the count says one. That is the honest reading of a count of
     * locations, and the alternative is to distinguish them by echoing them.
     */
    it("reports every offending location in one pass, deduplicated, in walk order", () => {
      const node = model(
        JSON.stringify({
          resourceType: "Patient",
          "a b": "1",
          "c=d": "2",
          contact: [{ "c/>d": "3" }, { "c/>d": "4" }],
          gender: "male",
        }),
      );
      const err = refusal(node);
      expect(err?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
      expect(err?.locations).toEqual([
        `Patient.${WITHHELD}`,
        `Patient.contact[0].${WITHHELD}`,
        `Patient.contact[1].${WITHHELD}`,
      ]);
      expect(err?.message).toContain("3 location(s)");
    });

    it("counts locations in the message and never the content", () => {
      const err = refusal(withName("a b"));
      expect(err?.message).toContain("1 location(s)");
      expect(err?.message).toContain("serializeResource encodes this model correctly");
    });
  });

  describe("every tag position, not just a top-level property", () => {
    it("refuses a name inside a backbone element", () => {
      expect(
        refusal(model(JSON.stringify({ resourceType: "Patient", name: [{ "a b": "x" }] })))
          ?.locations,
      ).toEqual([`Patient.name[0].${WITHHELD}`]);
    });

    it("refuses a name on an extension, whose tag is written by the same site", () => {
      expect(
        refusal(
          model(
            JSON.stringify({
              resourceType: "Patient",
              _gender: { extension: [{ url: "http://e", "a b": "x" }] },
            }),
          ),
        )?.code,
      ).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
    });

    it("refuses a resourceType at the ROOT, which is the tag rather than a child", () => {
      const err = refusal(
        model(JSON.stringify({ resourceType: 'P xmlns="urn:evil"', active: true })),
      );
      expect(err?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
      // The root location withholds too, so the forged type is not echoed either.
      expect(err?.locations).toEqual([WITHHELD]);
    });

    /**
     * A resource-valued element writes TWO tags, the wrapper and the inner resource type, at two
     * different sites. The inner one is covered by the complex-element site; the wrapper is its own
     * site and had no test until a mutation of it left this suite green.
     */
    it("refuses the WRAPPER name of a resource-valued element, not only the inner type", () => {
      const err = refusal(
        model(
          JSON.stringify({
            resourceType: "Patient",
            "c d": { resourceType: "Observation", status: "final" },
          }),
        ),
      );
      expect(err?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
      expect(err?.locations).toEqual([`Patient.${WITHHELD}`]);
    });

    it("refuses a resourceType inside a contained resource", () => {
      expect(
        refusal(
          model(
            JSON.stringify({
              resourceType: "Patient",
              contained: [{ resourceType: "O/><Patient", id: "c1" }],
            }),
          ),
        )?.code,
      ).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
    });
  });

  describe("the bound on the whole thing", () => {
    /**
     * THE INVARIANT THE REFUSAL EXISTS TO BUY, ASSERTED OVER GENERATED NAMES RATHER THAN A LIST.
     *
     * Either the writer refuses, or its output re-reads as the same property names in the same
     * order. A list of shapes can only ever say "not these"; this widens that to every name the
     * alphabet below can spell, which is built from exactly the characters that make a tag
     * ambiguous plus a few ordinary ones.
     *
     * **It is NOT a universal over all names, and the earlier draft of this comment claimed it
     * was.** The alphabet is the scope. It deliberately cannot spell `div`, which is a live
     * counterexample to the invariant as stated: `{"div":"v"}` emits `<Patient>v</Patient>` and the
     * property is gone on the re-read, because that name takes the raw-string branch rather than a
     * tag. That gap is pinned directly, below, rather than hidden by an alphabet that avoids it.
     */
    it("either refuses, or its output re-reads as the same property names", () => {
      const alphabet = [..."ab19-._:&\"'/<>= \t\n\r!?", " ", "", "\f", "é"];
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom(...alphabet), { minLength: 0, maxLength: 6 }),
          (chars) => {
            const name = chars.join("");
            // A leading `_` is the reader's primitive-extension sibling, a different mechanism
            // entirely: the model never holds a property under that name, so there is no tag to
            // compare against.
            if (name.startsWith("_")) return;
            const node = withName(name);
            // `resourceType` is compared out on both sides: it is a member in JSON and the TAG in
            // XML, so it always leads the XML reading whatever position the JSON object put it in,
            // and an integer-like key sorts ahead of it in a JavaScript object literal.
            const names = node.properties.map((p) => p.name).filter((n) => n !== "resourceType");
            let xml: string;
            try {
              xml = serializeResourceXml(node);
            } catch (err) {
              expect(err).toBeInstanceOf(FhirSerializeError);
              expect((err as FhirSerializeError).code).toBe(
                SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME,
              );
              return;
            }
            expect(
              parseResourceXml(xml)
                .resource.properties.map((p) => p.name)
                .filter((n) => n !== "resourceType"),
            ).toEqual(names);
          },
        ),
        { numRuns: 3000 },
      );
    });

    /**
     * The refusal cannot fire for a model read from XML, and that is a property of the raw reader's
     * tag scanner rather than a lucky corpus: it stops at exactly the characters that break a tag,
     * and refuses an empty name and a `<!` or `<?` opener before any name is read. So no XML
     * document, conformant or not, loses the ability to be written back.
     */
    it("is unreachable from a model this library read from XML", () => {
      const alphabet = [..."ab19-._:&\"'/<>= \t!?", "é"];
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom(...alphabet), { minLength: 1, maxLength: 6 }),
          (chars) => {
            const doc = `<Observation ${FHIR_NS}><${chars.join("")} value="1"/></Observation>`;
            let node: FhirComplex;
            try {
              node = parseResourceXml(doc).resource;
            } catch {
              return; // the reader refused the input; nothing reached the model.
            }
            // Specifically NOT this refusal. The OTHER one is reachable from XML and is supposed to
            // be: a tag that closes early leaves the rest of the text as character data on a FHIR
            // element, which is the dropped-text marker. Asserting "no refusal at all" here would
            // be asserting something false, which is how this test first failed.
            expect(refusal(node)?.code).not.toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
          },
        ),
        { numRuns: 3000 },
      );
    });
  });

  /**
   * 🔴 THE GAP THIS REFUSAL DOES NOT CLOSE, AND IT IS BIGGER THAN THE ONE IT DOES.
   *
   * `writeItem` emits a `div` property as its own raw string. It is the one markup-emitting site the
   * name check does not cover, and it is a FABRICATION route rather than merely an unreadability
   * one: a BALANCED string that closes its own element and opens siblings puts spec-clean FHIR into
   * the document that the sender never wrote, and it re-reads as ordinary content of the resource.
   *
   * `PRE-EXISTING`, older than the refusal above and not caused by it. Pinned here so it cannot move
   * in silence and so the disclosure on `serializeResourceXml` is load-bearing rather than prose.
   * **Characterization tests over a gap: closing it MUST red these, in the same change.**
   */
  describe("declared gap, NOT closed here: a div property is emitted as raw markup", () => {
    it("forges a no-known-allergy negation the record never asserted", () => {
      const forged = model(
        JSON.stringify({
          resourceType: "AllergyIntolerance",
          text: {
            status: "generated",
            div:
              '<div xmlns="http://www.w3.org/1999/xhtml">ok</div></text>' +
              '<code><coding><system value="http://snomed.info/sct"/>' +
              '<code value="716186003"/></coding></code><text>',
          },
        }),
      );
      // Nothing on the way in: no allergy code anywhere in the model, and no negation.
      expect(readSafety(forged).noKnownAllergy).toBe(false);
      expect(readSafety(forged).negations).toEqual([]);

      // Not refused. The name check governs names, and this is content.
      const xml = serializeResourceXml(forged);
      expect(xml).toContain('<code value="716186003"/>');

      // And it comes back as a positive clinical assertion, with the safety spine affirming it.
      const back = parseResourceXml(xml);
      expect(back.issues).toEqual([]);
      expect(readSafety(back.resource).noKnownAllergy).toBe(true);
      expect(readSafety(back.resource).negations).toEqual(["no-known-allergy"]);
      expect(readSafety(back.resource).safeToSummarize).toBe(true);
    });

    it("is keyed on the NAME div alone, so it is not confined to Narrative.div", () => {
      const forged = model(
        JSON.stringify({ resourceType: "Observation", div: '<status value="final"/>' }),
      );
      expect(readSafety(forged).status).toBeUndefined();
      const xml = serializeResourceXml(forged);
      expect(xml).toBe(`<Observation ${FHIR_NS}><status value="final"/></Observation>`);
      expect(readSafety(parseResourceXml(xml).resource).status).toBe("final");
    });

    it("silently deletes the property when the string carries no markup", () => {
      const node = model(JSON.stringify({ resourceType: "Patient", div: "v" }));
      expect(node.properties.map((p) => p.name)).toEqual(["resourceType", "div"]);
      const xml = serializeResourceXml(node);
      expect(xml).toBe(`<Patient ${FHIR_NS}>v</Patient>`);
      expect(parseResourceXml(xml).resource.properties.map((p) => p.name)).toEqual([
        "resourceType",
      ]);
    });

    it("is NOT closed by well-formedness, because the harmful shape is well-formed", () => {
      // The benign half, an unbalanced string, makes the document unreadable and is the variant the
      // first draft of the disclosure named. Recording both is the point: fixing only this one
      // leaves the fabrication above untouched.
      const unbalanced = model(
        JSON.stringify({ resourceType: "Patient", text: { div: "<div>not closed" } }),
      );
      expect(() => parseResourceXml(serializeResourceXml(unbalanced))).toThrow();
    });
  });
});
