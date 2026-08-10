import { describe, expect, it } from "vitest";

import {
  arrayWrappedScalars,
  assertSafeToSummarize,
  FhirSafetyError,
  FhirSerializeError,
  parseResource,
  readSafety,
  SERIALIZE_ERROR_CODES,
  serializeResourceXml,
  validateResource,
} from "../src/index.js";
import { NEGATION_CODE_READS } from "../src/safety/codes.js";

/**
 * A `Coding` wrapper the negation read decided on, reported where that read runs.
 *
 * The negation read is **not type-scoped**: a retraction and a refutation are read at every resource
 * root of every type, because a gate that never looks reports nothing and does so indistinguishably
 * from a clean read. The `Coding`-level array-wrapper report was still scoped to the closed set of
 * resource types the *cardinality table* covers, so the read had escaped the report:
 *
 * - `{"resourceType":"ServiceRequest","verificationStatus":{"coding":[{"code":["refuted"]}]}}`
 *   resolved `refuted` **through** a single-position array wrapper -- a shape FHIR JSON does not
 *   define -- and handed it back under `arrayWrappedScalars: []`, `safeToSummarize: true`,
 *   `valid: true`, with no diagnostic anywhere saying the value had come out of one.
 * - `{"…","verificationStatus":{"coding":[{"code":["entered-in-error","x"]}]}}` is the sharper half
 *   and runs the other way: a multi-position wrapper is deliberately **left unread**, because
 *   `system` and `code` feed a cross-product and taking more than one value on either side would
 *   pair values from different positions and assert a coding the sender never wrote. So the
 *   retraction was neither surfaced nor reported, and the readout affirmed `safeToSummarize: true`
 *   over a value the library knowingly declined to read.
 *
 * **What licenses reporting it at every root is that `Coding` is a datatype.** Its `system` and
 * `code` are `0..1` *wherever a `Coding` appears* (datatypes.html), so an array at either is
 * non-conformant whatever resource carries it and whatever the enclosing element's own cardinality
 * is. That is the difference from the element names one level up, where R4 really does define
 * repeating elements under the same names (`Questionnaire.code`, `ElementDefinition.code`, both
 * `0..*`), so a name-only rule there would report a conformant document as broken. The element-level
 * table therefore keeps its resource-type scoping, and its wrappers stay open residuals, pinned
 * below in both states.
 *
 * The report is decided from the same table the read is made from, so the two cannot drift into
 * covering different elements.
 *
 * Every assertion here is written through fields that exist at the base commit
 * (`arrayWrappedScalars`, `safeToSummarize`, `valid`, the issue list, the XML write refusal), so
 * each one measures a **behaviour** rather than the presence of a symbol. This slice adds no
 * exported symbol at all.
 *
 * All values are synthetic.
 */

/** The readout of a JSON document. */
function safetyOf(json: string): ReturnType<typeof readSafety> {
  return readSafety(parseResource(json).resource);
}

/** Whether `assertSafeToSummarize` refused, so the refusal can be asserted as a value. */
function refuses(json: string): boolean {
  try {
    assertSafeToSummarize(parseResource(json).resource);
    return false;
  } catch (err) {
    return err instanceof FhirSafetyError;
  }
}

/** A collection `Bundle` carrying one entry resource. */
const bundleWith = (resource: string): string =>
  `{"resourceType":"Bundle","type":"collection","entry":[{"resource":${resource}}]}`;

/** A `Patient` carrying one `contained` resource. */
const containing = (resource: string): string =>
  `{"resourceType":"Patient","contained":[${resource}]}`;

describe("a Coding wrapper the negation read went through is reported at the read's own window", () => {
  it("reports a single-position wrapper on a type outside the cardinality table", () => {
    const json =
      '{"resourceType":"ServiceRequest","verificationStatus":{"coding":[{"code":["refuted"]}]}}';
    const safety = safetyOf(json);

    // The read is unchanged: a single position is still transparent, so the refutation is surfaced.
    expect(safety.negations).toContain("refuted");
    // What moves is the refusal to affirm over it.
    expect(safety.arrayWrappedScalars).toStrictEqual([
      "ServiceRequest.verificationStatus.coding[0].code",
    ]);
    expect(safety.safeToSummarize).toBe(false);
    expect(refuses(json)).toBe(true);
  });

  it("reports both members of one Coding, in document order", () => {
    const safety = safetyOf(
      '{"resourceType":"ServiceRequest","verificationStatus":{"coding":[{"system":["s"],"code":["refuted"]}]}}',
    );

    expect(safety.arrayWrappedScalars).toStrictEqual([
      "ServiceRequest.verificationStatus.coding[0].system",
      "ServiceRequest.verificationStatus.coding[0].code",
    ]);
  });

  it("reports a multi-position wrapper the read refused, which surfaces no negation at all", () => {
    const json =
      '{"resourceType":"ServiceRequest","verificationStatus":{"coding":[{"code":["entered-in-error","x"]}]}}';
    const safety = safetyOf(json);

    // The read still declines it, deliberately: unwrapping more than one position would pair values
    // the sender wrote in different positions. The location is the only thing standing between that
    // and a positive verdict over a retraction the library chose not to read.
    expect(safety.negations).toStrictEqual([]);
    expect(safety.arrayWrappedScalars).toStrictEqual([
      "ServiceRequest.verificationStatus.coding[0].code",
    ]);
    expect(safety.safeToSummarize).toBe(false);
    expect(refuses(json)).toBe(true);
  });

  it("reports it inside a Bundle entry", () => {
    const safety = safetyOf(
      bundleWith(
        '{"resourceType":"ServiceRequest","verificationStatus":{"coding":[{"code":["entered-in-error"]}]}}',
      ),
    );

    expect(safety.negations).toContain("entered-in-error");
    expect(safety.arrayWrappedScalars).toStrictEqual([
      "Bundle.entry[0].resource.verificationStatus.coding[0].code",
    ]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("reports it inside contained", () => {
    const safety = safetyOf(
      containing(
        '{"resourceType":"Task","verificationStatus":{"coding":[{"code":["entered-in-error"]}]}}',
      ),
    );

    expect(safety.arrayWrappedScalars).toStrictEqual([
      "Patient.contained[0].verificationStatus.coding[0].code",
    ]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("reports it at an entry root carrying no readable resourceType", () => {
    // The entry node is a resource root by construction, whether or not it names a type. The type
    // gate is exactly what used to decide this one, so it is worth its own case.
    const safety = safetyOf('{"verificationStatus":{"coding":[{"code":["refuted"]}]}}');

    expect(safety.arrayWrappedScalars).toStrictEqual(["$this.verificationStatus.coding[0].code"]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("indexes the CodeableConcept when the element is itself array-wrapped", () => {
    const safety = safetyOf(
      '{"resourceType":"ServiceRequest","verificationStatus":[{"coding":[{"code":["refuted"]}]}]}',
    );

    // The element-level wrapper itself is still outside the cardinality table on this type (see the
    // residuals below), but the `Coding` inside it is addressed unambiguously all the same.
    expect(safety.arrayWrappedScalars).toStrictEqual([
      "ServiceRequest.verificationStatus[0].coding[0].code",
    ]);
  });

  it("covers a member a repeated property name shadowed", () => {
    const safety = safetyOf(
      '{"resourceType":"ServiceRequest","verificationStatus":{"coding":[{"code":"active"}]},' +
        '"verificationStatus":{"coding":[{"code":["refuted"]}]}}',
    );

    expect(safety.arrayWrappedScalars).toContain(
      "ServiceRequest.verificationStatus.coding[0].code",
    );
    expect(safety.safeToSummarize).toBe(false);
  });

  it("raises the wrapper as an error-severity issue, so the document is not valid", () => {
    const { resource } = parseResource(
      '{"resourceType":"ServiceRequest","verificationStatus":{"coding":[{"code":["refuted"]}]}}',
    );
    const result = validateResource(resource);
    const wrapped = result.issues.filter((issue) => issue.code === "ARRAY_WRAPPED_SCALAR");

    expect(wrapped.map((issue) => issue.expression)).toStrictEqual([
      "ServiceRequest.verificationStatus.coding[0].code",
    ]);
    expect(wrapped[0]?.severity).toBe("error");
    expect(result.valid).toBe(false);
  });

  it("reaches the standalone collector too, since both come from one walk", () => {
    const { resource } = parseResource(
      '{"resourceType":"ServiceRequest","verificationStatus":{"coding":[{"code":["refuted"]}]}}',
    );

    expect(arrayWrappedScalars(resource, "ServiceRequest")).toStrictEqual([
      "ServiceRequest.verificationStatus.coding[0].code",
    ]);
  });

  it("refuses to write a wrapper XML cannot spell back, rather than flattening it away", () => {
    const { resource } = parseResource(
      '{"resourceType":"ServiceRequest","verificationStatus":{"coding":[{"code":["refuted"]}]}}',
    );

    // A wrapper of fewer than two items emits at most one element, which re-reads as an ordinary
    // single-valued element -- so writing it would launder the finding away with the shape.
    let refused: FhirSerializeError | undefined;
    try {
      serializeResourceXml(resource);
    } catch (err) {
      refused = err instanceof FhirSerializeError ? err : undefined;
    }
    expect(refused?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER);
  });
});

describe("what does not move, pinned in both states", () => {
  it("reports each location exactly once where both windows cover it", () => {
    // `Condition` is in the cardinality table, so the element-level half and the negation read both
    // reach its `verificationStatus`. A caller acts on a location once.
    const safety = safetyOf(
      '{"resourceType":"Condition","verificationStatus":{"coding":[{"system":["s"],"code":["refuted"]}]}}',
    );

    expect(safety.arrayWrappedScalars).toStrictEqual([
      "Condition.verificationStatus.coding[0].system",
      "Condition.verificationStatus.coding[0].code",
    ]);
  });

  it("leaves a conformant document empty", () => {
    const json =
      '{"resourceType":"ServiceRequest","status":"active","intent":"order",' +
      '"verificationStatus":{"coding":[{"system":"s","code":"refuted"}]}}';
    const safety = safetyOf(json);

    expect(safety.negations).toContain("refuted");
    expect(safety.arrayWrappedScalars).toStrictEqual([]);
    expect(safety.safeToSummarize).toBe(true);
    expect(refuses(json)).toBe(false);
  });

  it("leaves a legitimately repeating element of the same name alone", () => {
    // `Questionnaire.code` is `0..*` in R4. Nothing here reads a negation off `code`, and reporting
    // it would be a false error on a conformant document.
    const safety = safetyOf(
      '{"resourceType":"Questionnaire","status":"active","code":[{"system":"s","code":"x"}]}',
    );

    expect(safety.arrayWrappedScalars).toStrictEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });

  it("leaves clinicalStatus on a type outside the table alone, because the read there is type-scoped", () => {
    // `clinicalStatus` is not a negation the walk reads; it reaches only the root convenience field,
    // which is type-scoped. Report scope follows read scope in both directions.
    const safety = safetyOf(
      '{"resourceType":"ServiceRequest","clinicalStatus":{"coding":[{"code":["active"]}]}}',
    );

    expect(safety.arrayWrappedScalars).toStrictEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });

  it("leaves a wrapped code on a type outside the table alone, since no-known-allergy stays type-scoped", () => {
    // A recorded "no known allergy" is a *positive* clinical assertion read off an element R4 does
    // not flag `?!`. Surfacing one from a type that does not define it would make a caller less
    // careful, so both its read and its report stay root- and type-scoped, on purpose.
    const safety = safetyOf(
      '{"resourceType":"ServiceRequest","code":{"coding":[{"system":["http://snomed.info/sct"],"code":["716186003"]}]}}',
    );

    expect(safety.negations).toStrictEqual([]);
    expect(safety.arrayWrappedScalars).toStrictEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });

  it("leaves a Coding wrapper at a code-typed status alone, because nothing reads through it", () => {
    // R4 spells `Procedure.status` a `code`, so a `CodeableConcept` written there holds no value
    // this layer takes anything from -- and it is exempt from the unreadable-shape channel too,
    // every member being one FHIR spells somewhere. That is an open residual of its own, and
    // reporting the wrapper inside it would be a report *wider* than the read, which is this
    // slice's own defect inverted. Pinned so a later widening has to move it deliberately.
    const safety = safetyOf(
      '{"resourceType":"Procedure","status":{"coding":[{"code":["not-done"]}]}}',
    );

    expect(safety.negations).toStrictEqual([]);
    expect(safety.unreadableNegationCodes).toStrictEqual([]);
    expect(safety.arrayWrappedScalars).toStrictEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });

  it("leaves a verificationStatus below a resource root alone", () => {
    // The window is a resource root. A backbone element has its own cardinalities, which this
    // library does not model. A declared limit, and the read does not go there either.
    const safety = safetyOf(
      '{"resourceType":"ServiceRequest","note":{"verificationStatus":{"coding":[{"code":["refuted"]}]}}}',
    );

    expect(safety.negations).toStrictEqual([]);
    expect(safety.arrayWrappedScalars).toStrictEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });
});

describe("the report is derived from the read's own table", () => {
  // Derived, not written down: whatever the table comes to hold, every element whose read resolves
  // through a `Coding` is covered at every resource root, and no element that does not is. A row
  // added or a flag moved has to move this, which is the property that keeps the two windows one
  // window.
  const throughCodings = NEGATION_CODE_READS.filter((read) => read.codings === true);
  const notThroughCodings = NEGATION_CODE_READS.filter((read) => read.codings !== true);

  it.each(throughCodings.map((read) => read.element))(
    "reports a wrapped Coding member at %s on a type outside the cardinality table",
    (element) => {
      const safety = safetyOf(
        `{"resourceType":"ServiceRequest","${element}":{"coding":[{"code":["entered-in-error"]}]}}`,
      );

      expect(safety.arrayWrappedScalars).toStrictEqual([
        `ServiceRequest.${element}.coding[0].code`,
      ]);
    },
  );

  it.each(notThroughCodings.map((read) => read.element))(
    "reports nothing under %s, whose read takes no value out of a Coding",
    (element) => {
      const safety = safetyOf(
        `{"resourceType":"ServiceRequest","${element}":{"coding":[{"code":["entered-in-error"]}]}}`,
      );

      expect(safety.arrayWrappedScalars).toStrictEqual([]);
    },
  );

  it("covers at least one element each way, so neither list above is vacuous", () => {
    expect(throughCodings.map((read) => read.element)).toStrictEqual(["verificationStatus"]);
    expect(notThroughCodings.map((read) => read.element)).toStrictEqual(["status"]);
  });
});

describe("the element-level wrappers stay open residuals", () => {
  // These are the *element* names, not the `Coding` datatype's members, so reporting them needs an
  // R4 census of the cardinality each of the three modifier element names has at a resource root on
  // every type that defines it. That is a different licence from this slice's, and it gets its own
  // change rather than riding along on this one.

  it("does not report an array-wrapped doNotPerform outside the cardinality table", () => {
    const safety = safetyOf('{"resourceType":"ServiceRequest","doNotPerform":[true]}');

    expect(safety.negations).toContain("do-not-perform");
    expect(safety.arrayWrappedScalars).toStrictEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });

  it("does not report an array-wrapped status outside the cardinality table", () => {
    const safety = safetyOf('{"resourceType":"Procedure","status":["not-done"]}');

    expect(safety.negations).toContain("not-done");
    expect(safety.arrayWrappedScalars).toStrictEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });

  it("does not report an array-wrapped verificationStatus element outside the cardinality table", () => {
    const safety = safetyOf(
      '{"resourceType":"ServiceRequest","verificationStatus":[{"coding":[{"code":"refuted"}]}]}',
    );

    expect(safety.negations).toContain("refuted");
    expect(safety.arrayWrappedScalars).toStrictEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });
});
