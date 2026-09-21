/**
 * A FHIR primitive whose value is written as element TEXT rather than `value=`.
 *
 * FHIR XML carries a primitive's value in the `value` attribute (xml.html §2.6.1: "values of
 * primitive types in a `value` attribute"), so `<status>entered-in-error</status>` is not a `status`
 * this library can read. The reader drops the character data, and before this suite existed the model
 * was then indistinguishable from a `status` the sender never wrote: the safety spine affirmed
 * `retracted: false`, `safeToSummarize: true`, `valid: true` over a retracted record.
 *
 * **Both halves are here now, and they are separate assertions.** The REPORTING half is that the
 * loss can never sit underneath an affirmative verdict. The READING half is that the value the
 * sender wrote reaches the safety readout anyway: the decision this file used to park - whether the
 * reader tolerates a primitive value written as element text - is taken, in one direction only. The
 * form is tolerated exactly far enough to surface the value; the content is never invented, the
 * encoding is still not conformant, and nothing about the report, the marker, the summarise refusal
 * or either writer's refusal moves.
 *
 * The comparand throughout is **the same document spelled the other way** (`value=`), not a previous
 * release: the question is whether the non-conformant spelling now reads the retraction, the
 * negation and the dose its conformant twin reads, while still refusing over the encoding, and
 * whether the twin itself reads exactly as it always did.
 */
import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  FhirSafetyError,
  FhirSerializeError,
  SERIALIZE_ERROR_CODES,
  droppedText,
  serializeResource,
  getProperty,
  isDroppedText,
  isList,
  isRetracted,
  nodesEquivalent,
  parseResource,
  parseResourceXml,
  readSafety,
  serializeResourceXml,
  validateResource,
  type FhirComplex,
  type FhirNode,
} from "../src/index.js";

const NS = 'xmlns="http://hl7.org/fhir"';

/** Every validation code a document raises, in order. */
function codes(resource: FhirComplex): string[] {
  return validateResource(resource).issues.map((issue) => issue.code);
}

/** The child node at `name`, which every document below writes exactly once. */
function child(node: FhirComplex, name: string): FhirNode {
  const found = getProperty(node, name);
  expect(found, `expected a ${name}`).toBeDefined();
  return found as FhirNode;
}

describe("the three shapes the defect was filed with, each against its conformant twin", () => {
  it("AC-1/AC-2/AC-3: reads a retraction written as element text, and still refuses over it", () => {
    const text = parseResourceXml(
      `<Observation ${NS}><id value="o1"/><status>entered-in-error</status></Observation>`,
    );
    const twin = parseResourceXml(
      `<Observation ${NS}><id value="o1"/><status value="entered-in-error"/></Observation>`,
    );

    // The twin is the yardstick: it reads the retraction, and this slice must not move it.
    expect(readSafety(twin.resource)).toMatchObject({
      retracted: true,
      negations: ["entered-in-error"],
      safeToSummarize: true,
      droppedText: [],
    });
    expect(twin.issues).toEqual([]);
    // The pair is deliberately minimal, so the built-in Observation element table raises the
    // mandatory `code` neither spelling carries. That is an ADDED finding and says nothing about the
    // retraction; `RETRACTED_RESOURCE` is what this test is here for and is unmoved.
    expect(codes(twin.resource)).toEqual(["CARDINALITY_MIN", "RETRACTED_RESOURCE"]);

    // AC-1: the same retraction and the same negations as the twin.
    const safety = readSafety(text.resource);
    expect(safety.retracted).toBe(true);
    expect(safety.negations).toEqual(readSafety(twin.resource).negations);
    // AC-2 and AC-3: the report, the location and the refusal all stand. The retraction now arrives
    // BESIDE the refusal instead of instead of it, which is the whole of what moved.
    expect(safety.safeToSummarize).toBe(false);
    expect(safety.droppedText).toEqual(["Observation.status"]);
    expect(text.issues).toEqual([
      { code: "UNEXPECTED_XML_CONTENT", severity: "warning", expression: "Observation.status" },
    ]);
    expect(codes(text.resource)).toContain("DROPPED_ELEMENT_TEXT");
    expect(codes(text.resource)).toContain("RETRACTED_RESOURCE");
    expect(validateResource(text.resource).valid).toBe(false);
    expect(() => {
      assertSafeToSummarize(text.resource);
    }).toThrow(FhirSafetyError);
    // AC-2: both writers still refuse the model, so the loss cannot launder across a round trip.
    expect(() => serializeResourceXml(text.resource)).toThrow(FhirSerializeError);
    expect(() => serializeResource(text.resource)).toThrow(FhirSerializeError);
  });

  it("AC-1/AC-2: reads a verificationStatus coding whose `refuted` is written as element text", () => {
    const coding = (code: string) =>
      `<coding><system value="http://terminology.hl7.org/CodeSystem/allergyintolerance-verification"/>${code}</coding>`;
    const text = parseResourceXml(
      `<AllergyIntolerance ${NS}><verificationStatus>${coding("<code>refuted</code>")}</verificationStatus></AllergyIntolerance>`,
    );
    const twin = parseResourceXml(
      `<AllergyIntolerance ${NS}><verificationStatus>${coding('<code value="refuted"/>')}</verificationStatus></AllergyIntolerance>`,
    );

    expect(readSafety(twin.resource).negations).toEqual(["refuted"]);
    expect(readSafety(twin.resource).safeToSummarize).toBe(true);

    // AC-1: the negation the coding spells now reaches the readout, from a position two levels down
    // that the single-value convenience field does not answer about.
    const safety = readSafety(text.resource);
    expect(safety.negations).toEqual(readSafety(twin.resource).negations);
    // AC-2 and AC-3: the report at its own position, the location, and the refusal.
    expect(safety.safeToSummarize).toBe(false);
    expect(safety.droppedText).toEqual(["AllergyIntolerance.verificationStatus.coding.code"]);
    expect(codes(text.resource)).toContain("DROPPED_ELEMENT_TEXT");
  });

  it("AC-1/AC-2: reads a doseQuantity's dose NUMBER, which was gone while its unit survived", () => {
    const dose = (value: string) =>
      `<MedicationRequest ${NS}><dosageInstruction><doseAndRate><doseQuantity>${value}<unit value="mg"/><system value="http://unitsofmeasure.org"/><code value="mg"/></doseQuantity></doseAndRate></dosageInstruction></MedicationRequest>`;
    const text = parseResourceXml(dose("<value>5</value>"));
    const twin = parseResourceXml(dose('<value value="5"/>'));

    const quantityOf = (resource: FhirComplex) =>
      child(
        child(
          child(child(resource, "dosageInstruction") as FhirComplex, "doseAndRate") as FhirComplex,
          "doseQuantity",
        ) as FhirComplex,
        "value",
      );

    // AC-1: the dose is the twin's dose, kept as its exact lexical string. This is the sharpest of
    // the three, because the surviving `mg` unit made the resource look complete without it.
    expect(quantityOf(twin.resource)).toMatchObject({ kind: "primitive", value: "5" });
    const recovered = quantityOf(text.resource);
    expect(recovered).toMatchObject({ kind: "primitive", value: "5" });
    // AC-2: the marker is still on the node the value was recovered from.
    expect(isDroppedText(recovered)).toBe(true);

    expect(readSafety(twin.resource).safeToSummarize).toBe(true);
    expect(readSafety(text.resource).safeToSummarize).toBe(false);
    expect(readSafety(text.resource).droppedText).toEqual([
      "MedicationRequest.dosageInstruction.doseAndRate.doseQuantity.value",
    ]);
    expect(codes(text.resource)).toContain("DROPPED_ELEMENT_TEXT");
  });

  it("AC-1: a decimal dose keeps the precision the document wrote, never a JS number's", () => {
    // The recovery hands back the lexical string the sender wrote, so the `0.010` / `0.01` hazard
    // the model exists to avoid is not reintroduced by the route the value now travels.
    const { resource } = parseResourceXml(
      `<Observation ${NS}><status value="final"/><valueQuantity><value>0.010</value><unit value="mg"/></valueQuantity></Observation>`,
    );
    const quantity = child(resource, "valueQuantity") as FhirComplex;
    expect(child(quantity, "value")).toMatchObject({ kind: "primitive", value: "0.010" });
  });
});

describe("the marker lands at every site `hasStrayText` observes text, and only there", () => {
  // The reader observes and discards character data at exactly three sites (`readComplex`, the
  // resource-valued unwrap, and the primitive branch of `buildSingle`). Counting them is the check;
  // the previous slice was refuted twice for writing a universal the call sites did not support.
  it("marks a primitive built without a `value` attribute", () => {
    const { resource } = parseResourceXml(
      `<Observation ${NS}><status>final</status></Observation>`,
    );
    expect(isDroppedText(child(resource, "status"))).toBe(true);
  });

  it("marks a complex element carrying text beside its child elements", () => {
    const { resource } = parseResourceXml(
      `<AllergyIntolerance ${NS}><verificationStatus>refuted<coding><code value="confirmed"/></coding></verificationStatus></AllergyIntolerance>`,
    );
    const status = child(resource, "verificationStatus");
    expect(status).toMatchObject({ kind: "complex" });
    expect(isDroppedText(status)).toBe(true);
    expect(readSafety(resource).droppedText).toEqual(["AllergyIntolerance.verificationStatus"]);
  });

  it("marks the resource-valued unwrap when text sits beside the wrapped resource", () => {
    const { resource } = parseResourceXml(
      `<Observation ${NS}><contained>stray<Patient><id value="p1"/></Patient></contained></Observation>`,
    );
    expect(isDroppedText(child(resource, "contained"))).toBe(true);
    expect(readSafety(resource).droppedText).toEqual(["Observation.contained"]);
  });

  it("AC-6: marks a primitive that DOES carry a value but also carries text, and keeps the value", () => {
    // The attribute wins outright and the text beside it is neither read, merged, nor compared
    // against it. `entered-in-error` sits in the character data and the readout does NOT see a
    // retraction, because the value the document put where R4 puts one says `final`.
    const { resource } = parseResourceXml(
      `<Observation ${NS}><status value="final">entered-in-error</status></Observation>`,
    );
    const status = child(resource, "status");
    expect(status).toMatchObject({ kind: "primitive", value: "final" });
    expect(isDroppedText(status)).toBe(true);
    expect(isRetracted(resource)).toBe(false);
    expect(readSafety(resource).negations).toEqual([]);
    expect(readSafety(resource).safeToSummarize).toBe(false);
    expect(readSafety(resource).droppedText).toEqual(["Observation.status"]);
  });

  it("does NOT mark character data that `String.trim()` calls whitespace, a PRE-EXISTING gap", () => {
    // The scope of both the flag and the marker is `hasStrayText`, which tests JS `String.trim()`.
    // That is WIDER than XML's whitespace production: U+00A0 and U+FEFF trim to empty, so a text
    // node made only of those is dropped with neither a flag nor a marker. Identical on base, and
    // pinned here rather than widened, because widening changes what the reader reports on documents
    // this change does not otherwise touch. It is why no sentence in this slice may say "wherever
    // text is dropped".
    for (const invisible of ["&#160;", "&#xFEFF;"]) {
      const { resource, issues } = parseResourceXml(
        `<Observation ${NS}><status>${invisible}</status></Observation>`,
      );
      expect(issues).toEqual([]);
      expect(isDroppedText(child(resource, "status"))).toBe(false);
      expect(readSafety(resource).droppedText).toEqual([]);
    }
  });

  it("AC-6: refuses even when the dropped text MATCHES the value, because the reader never compares them", () => {
    // The honest scope of the value-plus-text arm. Justifying it with "content the sender wrote is
    // missing" is false here: nothing is missing. The rule keys on the reader DROPPING character
    // data, and the tolerance does not reach this element at all, because a `value` attribute
    // arrived. Deciding this case is harmless would mean comparing the text against the value, which
    // is the one thing that stays out of the reader.
    const { resource } = parseResourceXml(
      `<Observation ${NS}><status value="final">final</status></Observation>`,
    );
    expect(child(resource, "status")).toMatchObject({ kind: "primitive", value: "final" });
    expect(isDroppedText(child(resource, "status"))).toBe(true);
    expect(readSafety(resource).safeToSummarize).toBe(false);
  });

  it("does NOT mark whitespace between elements, so ordinary indented XML is unaffected", () => {
    // The negative control that matters most: `hasStrayText` trims, and if it did not then every
    // pretty-printed document in the world would refuse to summarize.
    const { resource, issues } = parseResourceXml(`
      <Observation ${NS}>
        <id value="o1"/>
        <status value="final"/>
        <code><text value="synthetic"/></code>
      </Observation>
    `);
    expect(issues).toEqual([]);
    expect(isDroppedText(resource)).toBe(false);
    expect(isDroppedText(child(resource, "status"))).toBe(false);
    expect(readSafety(resource)).toMatchObject({ droppedText: [], safeToSummarize: true });
    expect(validateResource(resource).valid).toBe(true);
  });

  it("does NOT mark a narrative div, whose character data is carried rather than dropped", () => {
    const { resource } = parseResourceXml(
      `<Patient ${NS}><text><status value="generated"/><div xmlns="http://www.w3.org/1999/xhtml">Take 5 mg daily</div></text></Patient>`,
    );
    const div = child(child(resource, "text") as FhirComplex, "div");
    expect(div).toMatchObject({ kind: "primitive" });
    expect(String((div as { value?: unknown }).value)).toContain("Take 5 mg daily");
    expect(isDroppedText(div)).toBe(false);
    expect(readSafety(resource)).toMatchObject({ droppedText: [], safeToSummarize: true });
  });

  it("never marks a document read from JSON, which has no character-data channel", () => {
    const { resource } = parseResource(
      '{"resourceType":"Observation","status":"entered-in-error","note":[{"text":"x"}]}',
    );
    expect(readSafety(resource)).toMatchObject({
      droppedText: [],
      retracted: true,
      safeToSummarize: true,
    });
    expect(droppedText(resource, "Observation")).toEqual([]);
  });
});

describe("the walk reaches the whole document, at every depth", () => {
  it("reports text on an element inside a contained resource", () => {
    const { resource } = parseResourceXml(
      `<Observation ${NS}><contained><Patient><gender>female</gender></Patient></contained><status value="final"/></Observation>`,
    );
    expect(readSafety(resource).droppedText).toEqual(["Observation.contained.gender"]);
    expect(readSafety(resource).safeToSummarize).toBe(false);
  });

  it("reports text inside a Bundle entry, where a whole resource's status can hide", () => {
    const { resource } = parseResourceXml(
      `<Bundle ${NS}><type value="collection"/><entry><resource><Observation><status>entered-in-error</status></Observation></resource></entry></Bundle>`,
    );
    expect(readSafety(resource).droppedText).toEqual(["Bundle.entry.resource.status"]);
    expect(codes(resource)).toContain("DROPPED_ELEMENT_TEXT");
  });

  it("reports text inside a primitive's extension metadata", () => {
    const { resource } = parseResourceXml(
      `<Patient ${NS}><birthDate value="1970-01-01"><extension url="http://example.org/x"><valueString>note</valueString></extension></birthDate></Patient>`,
    );
    expect(readSafety(resource).droppedText).toEqual([
      "Patient.birthDate.extension[0].valueString",
    ]);
  });

  it("reports each repeated occurrence at its own indexed location", () => {
    const { resource } = parseResourceXml(
      `<Patient ${NS}><name><given>Peter</given></name><name><given value="Jane"/></name></Patient>`,
    );
    const names = child(resource, "name");
    expect(isList(names)).toBe(true);
    expect(readSafety(resource).droppedText).toEqual(["Patient.name[0].given"]);
  });
});

describe("the refusal surface", () => {
  it("carries the locations on the thrown error, value-free", () => {
    const { resource } = parseResourceXml(
      `<Observation ${NS}><status>entered-in-error</status><category>vital-signs</category></Observation>`,
    );
    try {
      assertSafeToSummarize(resource);
      expect.unreachable("assertSafeToSummarize should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(FhirSafetyError);
      const { locations, message } = error as FhirSafetyError;
      expect(locations).toEqual(["Observation.status", "Observation.category"]);
      // Value-free by contract: the codes the document wrote must not reach the message.
      expect(message).not.toContain("entered-in-error");
      expect(message).not.toContain("vital-signs");
    }
  });

  it("raises the validation issue at the position the text occupied, never its contents", () => {
    const { resource } = parseResourceXml(
      `<Observation ${NS}><status>entered-in-error</status></Observation>`,
    );
    const issue = validateResource(resource).issues.find(
      (candidate) => candidate.code === "DROPPED_ELEMENT_TEXT",
    );
    expect(issue).toMatchObject({ severity: "error", expression: "Observation.status" });
    expect(JSON.stringify(issue)).not.toContain("entered-in-error");
  });

  it("keeps the reader's own warning rather than replacing it", () => {
    // Additive, exactly as `NESTED_ARRAY` is: the read channel is unchanged by this slice.
    const { issues } = parseResourceXml(
      `<Observation ${NS}><status>entered-in-error</status></Observation>`,
    );
    expect(issues).toEqual([
      { code: "UNEXPECTED_XML_CONTENT", severity: "warning", expression: "Observation.status" },
    ]);
  });
});

describe("the cross-format oracle sees the difference", () => {
  it("AC-2: does not call a recovered value equivalent to one the document spelled conformantly", () => {
    const { resource: fromXml } = parseResourceXml(
      `<Observation ${NS}><status>entered-in-error</status></Observation>`,
    );
    // The same VALUE, arrived the way FHIR JSON spells it. The marker is now the only thing left
    // separating the two, which is what says the recovery did not quietly repair the document: a
    // caller comparing across the wire still sees that one of them was written non-conformantly.
    const { resource: fromJson } = parseResource(
      '{"resourceType":"Observation","status":"entered-in-error"}',
    );
    expect(nodesEquivalent(fromXml, fromJson)).toBe(false);
  });

  it("still calls the conformant twin equivalent to its JSON form", () => {
    const { resource: fromXml } = parseResourceXml(
      `<Observation ${NS}><status value="entered-in-error"/></Observation>`,
    );
    const { resource: fromJson } = parseResource(
      '{"resourceType":"Observation","status":"entered-in-error"}',
    );
    expect(nodesEquivalent(fromXml, fromJson)).toBe(true);
  });
});

describe("what the tolerance does NOT do, pinned so it cannot be mistaken for a repair", () => {
  // AC-5. The tolerance is bounded by the POSITION it reads at. Text on a complex element, and text
  // beside a resource-valued unwrap, have no value slot to be read into, so they stay dropped: the
  // location stays on the channel, the readout keeps refusing, and no value is minted anywhere.
  it("AC-5: reads no value where the element has no value slot to read one into", () => {
    const complexText = parseResourceXml(
      `<AllergyIntolerance ${NS}><verificationStatus>refuted<coding><code value="confirmed"/></coding></verificationStatus></AllergyIntolerance>`,
    );
    const status = child(complexText.resource, "verificationStatus");
    expect(status).toMatchObject({ kind: "complex" });
    expect((status as { value?: unknown }).value).toBeUndefined();
    // The refuted spelling was never reachable as a `code` and still is not: recovering it would be
    // authoring a coding the sender did not write.
    expect(readSafety(complexText.resource).negations).toEqual([]);
    expect(readSafety(complexText.resource).safeToSummarize).toBe(false);
    expect(readSafety(complexText.resource).droppedText).toEqual([
      "AllergyIntolerance.verificationStatus",
    ]);

    const unwrap = parseResourceXml(
      `<Observation ${NS}><contained>stray<Patient><id value="p1"/></Patient></contained></Observation>`,
    );
    expect(child(unwrap.resource, "contained")).toMatchObject({ kind: "complex" });
    expect(readSafety(unwrap.resource).droppedText).toEqual(["Observation.contained"]);
    expect(readSafety(unwrap.resource).safeToSummarize).toBe(false);
  });

  it("AC-5: reads two separated text runs as no value at all, rather than joining them", () => {
    // Two runs on either side of a child element are two things the sender wrote at two positions.
    // Joining them would mint a token the document does not contain anywhere, which is the one move
    // `clinical-safety` C1 forbids outright.
    const { resource } = parseResourceXml(
      `<Observation ${NS}><status>entered<extension url="http://example.org/x"/>-in-error</status></Observation>`,
    );
    const status = child(resource, "status");
    expect(status).toMatchObject({ kind: "primitive" });
    expect((status as { value?: unknown }).value).toBeUndefined();
    expect(isRetracted(resource)).toBe(false);
    expect(readSafety(resource).droppedText).toEqual(["Observation.status"]);
    expect(readSafety(resource).safeToSummarize).toBe(false);
  });

  it("AC-5: leaves a spelling the negation layer cannot classify recorded as a near miss", () => {
    // The value is recovered exactly as written; it is never case-folded into the code it nearly
    // spells. `NOT-DONE` is not the code `not-done`, so the negation stays unclassified and the
    // near-miss channel is what discloses it.
    const { resource } = parseResourceXml(`<Procedure ${NS}><status>NOT-DONE</status></Procedure>`);
    expect(child(resource, "status")).toMatchObject({ kind: "primitive", value: "NOT-DONE" });
    const safety = readSafety(resource);
    expect(safety.negations).toEqual([]);
    expect(safety.nearMissNegationCodes).toEqual(["Procedure.status"]);
    expect(safety.safeToSummarize).toBe(false);
    expect(safety.droppedText).toEqual(["Procedure.status"]);
  });

  it("AC-3: does not make a document that refuses to be summarised summarisable", () => {
    // The point of the whole change, stated as the thing it must not do: the refusal now arrives
    // BESIDE the retraction rather than instead of it.
    const { resource } = parseResourceXml(
      `<Observation ${NS}><status>entered-in-error</status></Observation>`,
    );
    expect(isRetracted(resource)).toBe(true);
    expect(readSafety(resource).safeToSummarize).toBe(false);
    expect(validateResource(resource).valid).toBe(false);
    expect(() => {
      assertSafeToSummarize(resource);
    }).toThrow(FhirSafetyError);
  });

  it("AC-2: no longer LAUNDERS on a write-and-re-read: BOTH writers refuse the marked model", () => {
    // This used to be the measured cost of shipping the reporting half alone, and it is closed by a
    // REFUSAL, not by recovering the text. The text is still not read; what changed is that neither
    // writer will emit a document in which the loss is invisible.
    const { resource } = parseResourceXml(
      `<Observation ${NS}><status>entered-in-error</status></Observation>`,
    );
    expect(readSafety(resource).safeToSummarize).toBe(false);

    // XML: emitting `<status/>` re-read clean, AND `<status/>` is itself a violation of xml.html
    // §2.6.1 ("FHIR elements are never empty ... SHALL have either a value attribute, child elements
    // as defined for its type, or 1 or more extensions").
    expect(() => serializeResourceXml(resource)).toThrow(FhirSerializeError);
    // JSON: worse, not better. It has no character-data channel, so the member vanished entirely and
    // the retracted Observation re-read as one that never named a status at all.
    expect(() => serializeResource(resource)).toThrow(FhirSerializeError);

    // The refusal is typed, value-free, and names the location, never the text it could not encode.
    const err = (() => {
      try {
        serializeResourceXml(resource);
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(FhirSerializeError);
    const typed = err as FhirSerializeError;
    expect(typed.code).toBe(SERIALIZE_ERROR_CODES.DROPPED_ELEMENT_TEXT);
    expect(typed.locations).toEqual(["Observation.status"]);
    expect(typed.message).not.toContain("entered-in-error");
    expect(JSON.stringify(typed.locations)).not.toContain("entered-in-error");
  });

  it("refuses only the marked model: the conformant twin still round-trips byte-for-byte", () => {
    // The negative half of the rule, and the one that says the refusal is not a blanket. The same
    // document spelled with `value=` is untouched, as is every document read from JSON, which has no
    // character-data channel at all.
    const twin = `<Observation ${NS}><status value="entered-in-error"/></Observation>`;
    const { resource } = parseResourceXml(twin);
    expect(serializeResourceXml(resource)).toBe(twin);
    expect(serializeResource(resource)).toBe(
      '{"resourceType":"Observation","status":"entered-in-error"}',
    );
    expect(isRetracted(resource)).toBe(true);

    // A value-absent primitive with NO marker is NOT refused: the writer's §2.6.1 residual for an
    // `id`-only element is untouched by this slice, and is left as the separate decision it is.
    const idOnly = parseResource('{"resourceType":"Patient","_active":{"id":"a"}}');
    expect(serializeResourceXml(idOnly.resource)).toContain('<active id="a"/>');
  });
});
