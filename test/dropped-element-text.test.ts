/**
 * A FHIR primitive whose value is written as element TEXT rather than `value=`.
 *
 * FHIR XML carries a primitive's value in the `value` attribute (xml.html §2.6.1: "values of
 * primitive types in a `value` attribute"), so `<status>entered-in-error</status>` is not a `status`
 * this library can read. The reader drops the character data, and before this suite existed the model
 * was then indistinguishable from a `status` the sender never wrote: the safety spine affirmed
 * `retracted: false`, `safeToSummarize: true`, `valid: true` over a retracted record.
 *
 * **This is the REPORTING half.** The text is not read back as the element's value — that would be a
 * tolerance for a non-conformant encoding, a decision about what this reader accepts, and it is not
 * taken here. What is asserted is that the loss can no longer sit underneath an affirmative verdict.
 *
 * The comparand throughout is **the same document spelled the other way** (`value=`), not a previous
 * release: the question is whether the conformant twin still reads exactly as it always did while the
 * non-conformant one stops affirming.
 */
import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  FhirSafetyError,
  droppedText,
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
  it("reads a retraction written as element text as a refusal, not an affirmation", () => {
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
    expect(codes(twin.resource)).toEqual(["RESOURCE_NOT_MODELED", "RETRACTED_RESOURCE"]);

    // The non-conformant spelling still cannot READ the retraction — the value is not in the model
    // and this half does not put it there — but it no longer claims the record is fine.
    const safety = readSafety(text.resource);
    expect(safety.retracted).toBe(false);
    expect(safety.negations).toEqual([]);
    expect(safety.safeToSummarize).toBe(false);
    expect(safety.droppedText).toEqual(["Observation.status"]);
    expect(codes(text.resource)).toContain("DROPPED_ELEMENT_TEXT");
    expect(validateResource(text.resource).valid).toBe(false);
    expect(() => {
      assertSafeToSummarize(text.resource);
    }).toThrow(FhirSafetyError);
  });

  it("refuses over a verificationStatus coding whose `refuted` is written as element text", () => {
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

    const safety = readSafety(text.resource);
    // The negation is still not readable: the code never reached the model. What changed is that the
    // readout no longer presents that as a document with nothing to say.
    expect(safety.negations).toEqual([]);
    expect(safety.safeToSummarize).toBe(false);
    expect(safety.droppedText).toEqual(["AllergyIntolerance.verificationStatus.coding.code"]);
    expect(codes(text.resource)).toContain("DROPPED_ELEMENT_TEXT");
  });

  it("refuses over a doseQuantity that lost the dose NUMBER while its unit and UCUM code survived", () => {
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

    // The twin keeps the number; the other spelling does not. This is the sharpest of the three,
    // because the surviving `mg` unit makes the resource look complete.
    expect(quantityOf(twin.resource)).toMatchObject({ kind: "primitive", value: "5" });
    const lost = quantityOf(text.resource);
    expect(lost).toMatchObject({ kind: "primitive" });
    expect((lost as { value?: unknown }).value).toBeUndefined();
    expect(isDroppedText(lost)).toBe(true);

    expect(readSafety(twin.resource).safeToSummarize).toBe(true);
    expect(readSafety(text.resource).safeToSummarize).toBe(false);
    expect(readSafety(text.resource).droppedText).toEqual([
      "MedicationRequest.dosageInstruction.doseAndRate.doseQuantity.value",
    ]);
    expect(codes(text.resource)).toContain("DROPPED_ELEMENT_TEXT");
  });
});

describe("the marker lands at every site the reader drops character data, and only there", () => {
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

  it("marks a primitive that DOES carry a value but also carries text, because the text is dropped too", () => {
    // A narrower loss than the headline (the value survives), but content the sender wrote is still
    // missing from the model, so the same refusal applies rather than a second, softer rule.
    const { resource } = parseResourceXml(
      `<Observation ${NS}><status value="final">entered-in-error</status></Observation>`,
    );
    const status = child(resource, "status");
    expect(status).toMatchObject({ kind: "primitive", value: "final" });
    expect(isDroppedText(status)).toBe(true);
    expect(readSafety(resource).safeToSummarize).toBe(false);
  });

  it("does NOT mark whitespace between elements, so ordinary indented XML is unaffected", () => {
    // The negative control that matters most: `hasStrayText` trims, and if it did not then every
    // pretty-printed document in the world would refuse to summarize.
    const { resource, issues } = parseResourceXml(`
      <Observation ${NS}>
        <id value="o1"/>
        <status value="final"/>
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
      `<Patient ${NS}><name><given>Ada</given></name><name><given value="Grace"/></name></Patient>`,
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
  it("does not call an element whose text was dropped equivalent to a genuinely absent value", () => {
    const { resource: fromXml } = parseResourceXml(
      `<Observation ${NS}><status>entered-in-error</status></Observation>`,
    );
    // The JSON counterpart of a value-absent primitive: the same node shape, honestly empty.
    const { resource: fromJson } = parseResource(
      '{"resourceType":"Observation","status":null,"_status":{"id":"s"}}',
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

describe("what this half deliberately does NOT do, pinned so it cannot be mistaken for done", () => {
  it("does not read the text back as the element's value", () => {
    const { resource } = parseResourceXml(
      `<Observation ${NS}><status>entered-in-error</status></Observation>`,
    );
    // Recovering the value is a TOLERANCE for a non-conformant encoding, which needs a real document
    // to ground it. Nothing here grounds it, so the value stays unread and the verdict stays a
    // refusal rather than a repair.
    expect(isRetracted(resource)).toBe(false);
    expect(getProperty(resource, "status")).toMatchObject({ kind: "primitive" });
  });

  it("LAUNDERS on a write-and-re-read, because the writer has no slot to emit the marker", () => {
    // The measured cost of shipping the reporting half alone: `serializeResourceXml` emits
    // `<status/>` for a value-absent primitive, so the re-read is clean and the refusal is gone.
    // Closing this belongs to the preserving half, which would have to keep the text.
    const { resource } = parseResourceXml(
      `<Observation ${NS}><status>entered-in-error</status></Observation>`,
    );
    expect(readSafety(resource).safeToSummarize).toBe(false);

    const emitted = serializeResourceXml(resource);
    expect(emitted).toContain("<status/>");
    const reread = parseResourceXml(emitted);
    expect(reread.issues).toEqual([]);
    expect(readSafety(reread.resource).safeToSummarize).toBe(true);
    expect(readSafety(reread.resource).droppedText).toEqual([]);
  });
});
