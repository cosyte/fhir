import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  ENTERED_IN_ERROR,
  FhirSafetyError,
  nearMissNegationCodes,
  NOT_DONE,
  NOT_TAKEN,
  NO_KNOWN_ALLERGY,
  parseResource,
  parseResourceXml,
  readSafety,
  REFUTED,
  serializeResource,
  SNOMED_SCT,
} from "../src/index.js";
import { isNearMissCode, NEGATION_CODE_READS } from "../src/safety/codes.js";

const FHIR_NS = 'xmlns="http://hl7.org/fhir"';

/** The readout of a JSON document, written out so each assertion below reads the literal it pins. */
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

const CONDITION_VERIFICATION = "http://terminology.hl7.org/CodeSystem/condition-ver-status";

/**
 * The whitespace R4's own `code` regex recognises, `[^\s]+(\s[^\s]+)*` (datatypes.html), where
 * `\s` is XML Schema's four-character class. Written out here rather than derived from the source so
 * that a change to the source's set reds this file instead of silently agreeing with it.
 */
const R4_CODE_WHITESPACE = [" ", "\t", "\n", "\r"] as const;

/**
 * **Exact-string matching silently dropped a negation the sender plainly spelled.**
 *
 * At the base commit `fa5bfd8`, every one of these read `negations: []` under
 * `safeToSummarize: true`, with **no location anywhere** saying a value had been looked at and
 * declined:
 *
 * ```
 * {"resourceType":"Procedure","status":"NOT-DONE"}       ->  negations: []  safeToSummarize: true
 * {"resourceType":"Procedure","status":" not-done"}      ->  negations: []  safeToSummarize: true
 * {"resourceType":"Observation","status":"Entered-In-Error"} -> negations: []  safeToSummarize: true
 * {"resourceType":"AllergyIntolerance",
 *  "verificationStatus":{"coding":[{"code":"REFUTED"}]}} ->  negations: []  safeToSummarize: true
 * ```
 *
 * **The exact match is CORRECT and this slice does not touch it.** FHIR `code` is case-sensitive,
 * and the `code` datatype's lexical space has no room for surrounding whitespace, so `"NOT-DONE"`
 * and `" not-done"` are **not** the code `not-done`. A reader that folded them in would accept a
 * non-conformant document as though it were conformant and hand a caller a negation its sender never
 * spelled: the same laundering class this package refuses everywhere else, and the reason the fix
 * belongs at the READ rather than in the reader.
 *
 * **The defect is the silence, not the strictness.** `status` surfaces the raw value either way, so
 * nothing was lost; what was missing was any record that the *classification* had declined. A caller
 * doing exactly what this readout instructs (branch on `negations`, not on the raw status string)
 * therefore read a procedure recorded as `"NOT-DONE"` as a procedure with nothing to say about it.
 * So the remedy is a **disclosure**: a location on `nearMissNegationCodes`, `safeToSummarize` false,
 * and `assertSafeToSummarize` refusing. Nothing is coerced, trimmed or case-folded.
 *
 * **The class is wider than the two spellings the item named**, and the census is the slice. Over the
 * codes the safety layer classifies, at every element and every resource root each is read at, the
 * gap covered *every* case variant and *every* surrounding-whitespace form, for all four
 * `?!`-modifier-element codes rather than the two quoted, with one axis that does not exist: SNOMED
 * `716186003` is digits, so case cannot vary it at all.
 *
 * **What this slice is NOT the first of, stated so the claim stays honest.** `do-not-perform`, the
 * one *boolean* negation, was **already** disclosed for exactly this class of value:
 * `<doNotPerform value="TRUE"/>` and `value=" true"` have landed on `unreadableBooleans` under
 * `safeToSummarize: false` since that channel shipped. What had no complement was the **code**-valued
 * half. Pinned below in both states.
 *
 * **Corpus caveat:** every document here is hand-authored, synthetic, and carries no patient content.
 * These are fixtures, mutations and probes, **not** the R4 published-examples corpus.
 */
describe("a code spelling a negation bar its case or its whitespace is disclosed, not read", () => {
  describe("axis: the gap the item named, on `status`", () => {
    it("discloses an upper-cased not-done instead of reading nothing", () => {
      const safety = safetyOf('{"resourceType":"Procedure","status":"NOT-DONE"}');

      // Still not a negation, and that is the correct reading: `code` is case-sensitive.
      expect(safety.negations).toEqual([]);
      // But no longer silent. This is the whole of the change.
      expect(safety.nearMissNegationCodes).toEqual(["Procedure.status"]);
      expect(safety.safeToSummarize).toBe(false);
      // At a resource root with one value, the convenience field shows it unchanged. That is a
      // fact about THIS document, not a promise of the channel: see the nested cases below.
      expect(safety.status).toBe("NOT-DONE");
    });

    it("discloses a not-done padded with a leading space", () => {
      const safety = safetyOf('{"resourceType":"Procedure","status":" not-done"}');

      expect(safety.negations).toEqual([]);
      expect(safety.nearMissNegationCodes).toEqual(["Procedure.status"]);
      expect(safety.status).toBe(" not-done");
    });

    it("discloses a case-varied entered-in-error", () => {
      const safety = safetyOf('{"resourceType":"Observation","status":"Entered-In-Error"}');

      expect(safety.negations).toEqual([]);
      expect(safety.retracted).toBe(false);
      expect(safety.nearMissNegationCodes).toEqual(["Observation.status"]);
    });

    it("discloses a case-varied not-taken", () => {
      const safety = safetyOf('{"resourceType":"MedicationStatement","status":"Not-Taken"}');

      expect(safety.negations).toEqual([]);
      expect(safety.nearMissNegationCodes).toEqual(["MedicationStatement.status"]);
    });

    it("refuses to summarize, and the refusal carries the location and no value", () => {
      const doc = '{"resourceType":"Procedure","status":"NOT-DONE"}';
      expect(refuses(doc)).toBe(true);
      try {
        assertSafeToSummarize(parseResource(doc).resource);
        expect.unreachable("assertSafeToSummarize must refuse a near-miss negation code");
      } catch (err) {
        expect(err).toBeInstanceOf(FhirSafetyError);
        const safetyError = err as FhirSafetyError;
        expect(safetyError.locations).toEqual(["Procedure.status"]);
        // Value-free by contract: neither the text that failed to match nor the code it resembles
        // reaches the message. A near-miss can sit on an element a sender filled with anything.
        expect(safetyError.message).not.toContain("NOT-DONE");
        expect(safetyError.message).not.toContain("not-done");
      }
    });

    it("echoes no document content into the location channel", () => {
      // The channel names the element, never the value. A sentinel stands in for the arbitrary text
      // a sender can put at a PHI-adjacent element.
      const safety = safetyOf(
        `{"resourceType":"Procedure","status":${JSON.stringify(" NOT-DONE\tZq7")}}`,
      );
      expect(safety.nearMissNegationCodes.join("|")).not.toContain("Zq7");
      // ...and that document is NOT a near miss, because the trailing token is not padding.
      expect(safety.nearMissNegationCodes).toEqual([]);
    });
  });

  describe("axis: the same gap on a `verificationStatus` coding", () => {
    it("discloses an upper-cased refuted", () => {
      const safety = safetyOf(
        '{"resourceType":"AllergyIntolerance","verificationStatus":{"coding":[{"code":"REFUTED"}]}}',
      );

      expect(safety.negations).toEqual([]);
      expect(safety.nearMissNegationCodes).toEqual(["AllergyIntolerance.verificationStatus"]);
      expect(safety.safeToSummarize).toBe(false);
    });

    it("discloses a padded entered-in-error under its own code system", () => {
      const safety = safetyOf(
        '{"resourceType":"Condition","verificationStatus":{"coding":[' +
          `{"system":"${CONDITION_VERIFICATION}","code":"entered-in-error "}]}}`,
      );

      expect(safety.negations).toEqual([]);
      expect(safety.retracted).toBe(false);
      expect(safety.nearMissNegationCodes).toEqual(["Condition.verificationStatus"]);
    });

    it("names the element once however many codings near-miss inside it", () => {
      // The location names the element, exactly as `shadowedProperties` does: FHIRPath cannot
      // address "the second coding's code" any more than it can address a shadowed member.
      const safety = safetyOf(
        '{"resourceType":"AllergyIntolerance","verificationStatus":{"coding":[' +
          '{"code":"REFUTED"},{"code":" entered-in-error"}]}}',
      );

      expect(safety.nearMissNegationCodes).toEqual(["AllergyIntolerance.verificationStatus"]);
    });
  });

  describe("axis: every surrounding-whitespace form R4's own `code` regex names", () => {
    for (const ws of R4_CODE_WHITESPACE) {
      it(`discloses a not-done padded with ${JSON.stringify(ws)} on either side`, () => {
        for (const value of [`${ws}${NOT_DONE}`, `${NOT_DONE}${ws}`, `${ws}${NOT_DONE}${ws}`]) {
          const safety = safetyOf(`{"resourceType":"Procedure","status":${JSON.stringify(value)}}`);
          expect(safety.negations).toEqual([]);
          expect(safety.nearMissNegationCodes).toEqual(["Procedure.status"]);
        }
      });
    }

    it("discloses case and whitespace together, which is the shape a real feed produces", () => {
      // An upper-casing source system whose extract also pads a fixed-width field.
      const safety = safetyOf(
        `{"resourceType":"Procedure","status":${JSON.stringify("  NOT-DONE\t")}}`,
      );
      expect(safety.nearMissNegationCodes).toEqual(["Procedure.status"]);
    });
  });

  describe("axis: at every resource root, which is the negation read's own window", () => {
    const nearMiss = '{"resourceType":"Procedure","status":"NOT-DONE"}';

    it("discloses one inside a Bundle entry", () => {
      const safety = safetyOf(bundleWith(nearMiss));

      expect(safety.negations).toEqual([]);
      expect(safety.nearMissNegationCodes).toEqual(["Bundle.entry[0].resource.status"]);
      expect(safety.safeToSummarize).toBe(false);
    });

    it("discloses one inside a contained resource", () => {
      const safety = safetyOf(containing(nearMiss));

      expect(safety.nearMissNegationCodes).toEqual(["Patient.contained[0].status"]);
    });

    it("reports the standalone collector at the same locations as the readout", () => {
      // The exported collector and the readout channel are one call, not two rules that can drift.
      const { resource } = parseResource(bundleWith(nearMiss));
      expect(nearMissNegationCodes(resource, "Bundle")).toEqual(
        readSafety(resource).nearMissNegationCodes,
      );
    });
  });

  describe("axis: the same values a negation read sees, through the same readers", () => {
    it("sees through an array wrapper, and the wrapper is still reported beside it", () => {
      const safety = safetyOf('{"resourceType":"Observation","status":["Entered-In-Error"]}');

      expect(safety.nearMissNegationCodes).toEqual(["Observation.status"]);
      // The wrapper's own report is unchanged: two findings at one location, from two rules.
      expect(safety.arrayWrappedScalars).toEqual(["Observation.status"]);
    });

    it("still discloses where the wrapper's own report does not reach, a declared residual", () => {
      // `arrayWrappedScalars` is scoped to a cardinality table on the safety resource types, and
      // `Procedure` is not one, so the wrapper here is unreported at BOTH states: a residual filed
      // against the array-wrapper rule, not something this slice changes. The near-miss read goes
      // through the same value reader the negation read does, which sees into the wrapper, so head
      // is strictly better than base at this document rather than complete at it.
      const safety = safetyOf('{"resourceType":"Procedure","status":["NOT-DONE"]}');

      expect(safety.arrayWrappedScalars).toEqual([]);
      expect(safety.nearMissNegationCodes).toEqual(["Procedure.status"]);
      expect(safety.safeToSummarize).toBe(false);
    });

    it("sees a value a repeated property name shadowed", () => {
      // First-wins would have skipped it. A near miss must not become invisible by arriving second,
      // for the same reason a retraction must not.
      const safety = safetyOf(
        '{"resourceType":"Procedure","status":"completed","status":"NOT-DONE"}',
      );

      expect(safety.nearMissNegationCodes).toEqual(["Procedure.status"]);
      expect(safety.status).toBe("completed");
    });

    it("survives this package's own JSON round trip and is reported again", () => {
      const { resource } = parseResource('{"resourceType":"Procedure","status":" not-done"}');
      const round = safetyOf(serializeResource(resource));

      expect(round.nearMissNegationCodes).toEqual(["Procedure.status"]);
      expect(round.negations).toEqual([]);
    });

    it("is disclosed on a document read from XML too", () => {
      const safety = readSafety(
        parseResourceXml(`<Procedure ${FHIR_NS}><status value="NOT-DONE"/></Procedure>`).resource,
      );

      expect(safety.nearMissNegationCodes).toEqual(["Procedure.status"]);
    });
  });

  describe("what the disclosure does NOT promise, and where it must not fire", () => {
    it("draws nothing where the same element also spells that code exactly", () => {
      // A CONFORMANT R4 document. A required binding requires one coding from the value set and
      // permits translations beside it (terminologies.html), so this carries `refuted` from the
      // standard system and a local system's upper-cased spelling of the same concept. The negation
      // IS classified, so the caller has it and there is nothing to disclose; firing here would
      // refuse to summarize a document this library read correctly and completely.
      const safety = safetyOf(
        '{"resourceType":"Condition","verificationStatus":{"coding":[' +
          `{"system":"${CONDITION_VERIFICATION}","code":"refuted"},` +
          '{"system":"http://example.org/legacy","code":"REFUTED"}]}}',
      );

      expect(safety.negations).toEqual([REFUTED]);
      expect(safety.nearMissNegationCodes).toEqual([]);
      expect(safety.safeToSummarize).toBe(true);
    });

    it("suppresses per code, so a near miss of a DIFFERENT code at that element still reports", () => {
      // The other half of the same rule, and the one that stops the suppression becoming a hole:
      // `refuted` is classified, but nothing classifies the retraction the second coding spells.
      const safety = safetyOf(
        '{"resourceType":"Condition","verificationStatus":{"coding":[' +
          `{"system":"${CONDITION_VERIFICATION}","code":"refuted"},` +
          '{"system":"http://example.org/legacy","code":"ENTERED-IN-ERROR"}]}}',
      );

      expect(safety.negations).toEqual([REFUTED]);
      expect(safety.nearMissNegationCodes).toEqual(["Condition.verificationStatus"]);
    });

    it("does not promise the near-missed value reaches a convenience field, nested", () => {
      // The channel is document-wide; `status` is root-scoped. So the location is the only thing
      // that finds the value, and a caller must walk the model at it rather than read `status`.
      const safety = safetyOf(
        '{"resourceType":"MedicationRequest","status":"active","intent":"order",' +
          '"contained":[{"resourceType":"Procedure","status":"NOT-DONE"}]}',
      );

      expect(safety.nearMissNegationCodes).toEqual(["MedicationRequest.contained[0].status"]);
      // The convenience field shows the ROOT's value, which is a different value entirely.
      expect(safety.status).toBe("active");
    });

    it("does not promise it either when the near miss is in a second coding", () => {
      // `verificationStatus` surfaces the preferred-system coding, so the code it shows is not the
      // one that near-missed. `confirmed` is not a negation, so nothing suppresses the disclosure.
      const safety = safetyOf(
        '{"resourceType":"Condition","verificationStatus":{"coding":[' +
          `{"system":"${CONDITION_VERIFICATION}","code":"confirmed"},` +
          '{"system":"http://example.org/legacy","code":"REFUTED"}]}}',
      );

      expect(safety.nearMissNegationCodes).toEqual(["Condition.verificationStatus"]);
      expect(safety.verificationStatus).toBe("confirmed");
    });

    it("discloses an XML whitespace near miss, a DECLARED limit rather than a conformance claim", () => {
      // R4 derives `code` from `xs:token` (fhir-base.xsd), whose `whiteSpace=collapse` facet strips
      // surrounding whitespace BEFORE validation, so this document is schema-valid and a
      // schema-validating consumer reads it as the code. This reader is schema-free and does not
      // collapse, so it discloses rather than reads. Fail-safe, and pinned so it cannot be mistaken
      // for a claim that the channel is empty on every conformant document in either wire format.
      const safety = readSafety(
        parseResourceXml(`<Procedure ${FHIR_NS}><status value=" not-done"/></Procedure>`).resource,
      );

      expect(safety.negations).toEqual([]);
      expect(safety.nearMissNegationCodes).toEqual(["Procedure.status"]);
    });
  });

  /**
   * **BOTH-STATES PINS. Every assertion in this block is base-observable and passes at `fa5bfd8`
   * unchanged**, which is what makes it a control rather than a restatement of the fix: each names a
   * document this slice must leave exactly where it found it.
   *
   * They are written on `safeToSummarize` and `negations` rather than on the new channel
   * deliberately. That channel does not exist at the base commit, so an
   * `expect(...nearMissNegationCodes).toEqual([])` would go red there for the trivial reason that
   * the field reads `undefined` - a red that pins **nothing** and would inflate the red-at-base
   * fraction with vacuous entries. `safeToSummarize` is `true` only if the channel is empty, so this
   * asserts the same property through a field both states have. A previous slice in this arc
   * published a figure that overstated what was actually pinned; this block is written so the
   * figure reported for this one cannot.
   */
  describe("both states: the documents this slice must not move", () => {
    it("leaves a padded or case-varied code that is NOT a negation alone", () => {
      // The discriminating control. A rule that fired on "any code needing a trim" would pass every
      // test above and be a completely different, far wider claim.
      for (const value of [" completed", "COMPLETED", "Final ", " active", "IN-PROGRESS"]) {
        const safety = safetyOf(`{"resourceType":"Procedure","status":${JSON.stringify(value)}}`);
        expect(safety.negations).toEqual([]);
        expect(safety.safeToSummarize).toBe(true);
      }
    });

    it("leaves a value near a negation code by anything but case or padding alone", () => {
      // Not a fuzzy match, and deliberately not one: a rule that guessed at intent would be the
      // coercion this slice exists to refuse, one step removed.
      for (const value of ["notdone", "not_done", "not done", "not-don", "not-donee", "no-done"]) {
        const safety = safetyOf(`{"resourceType":"Procedure","status":${JSON.stringify(value)}}`);
        expect(safety.safeToSummarize).toBe(true);
      }
    });

    it("leaves whitespace R4's `code` regex does not call whitespace alone", () => {
      // A no-break space, a narrow no-break space and a byte-order mark are ordinary characters
      // INSIDE a conformant `code`, so trimming one would call a value non-conformant that R4
      // accepts. JavaScript's `\s` matches all three; XML Schema's four-character class matches
      // none, and R4's regex is XML Schema's.
      for (const pad of ["\u00a0", "\u202f", "\ufeff"]) {
        const safety = safetyOf(
          `{"resourceType":"Procedure","status":${JSON.stringify(`${pad}${NOT_DONE}`)}}`,
        );
        expect(safety.safeToSummarize).toBe(true);
      }
    });

    it("leaves every conformant document reading exactly as it did", () => {
      // `safeToSummarize` does not move for a value that IS read, and every exact code still
      // classifies: the control that says nothing which already worked was disturbed.
      for (const [type, code] of [
        ["Procedure", NOT_DONE],
        ["MedicationStatement", NOT_TAKEN],
        ["Observation", ENTERED_IN_ERROR],
      ] as const) {
        const safety = safetyOf(`{"resourceType":"${type}","status":"${code}"}`);
        expect(safety.negations).toEqual([code]);
        expect(safety.safeToSummarize).toBe(true);
      }
      const refutedDoc = safetyOf(
        '{"resourceType":"AllergyIntolerance","verificationStatus":{"coding":[{"code":"refuted"}]}}',
      );
      expect(refutedDoc.negations).toEqual([REFUTED]);
      expect(refutedDoc.safeToSummarize).toBe(true);

      // MULTI-CODING, and it is the shape a single-coding control does not discriminate. A required
      // binding requires one coding from the value set and PERMITS translations beside it
      // (terminologies.html), so a standard `refuted` next to a local system's `REFUTED` is a
      // conformant document whose negation is classified. It read `safeToSummarize: true` at base
      // and must still, or the channel refuses to summarize a document read correctly.
      const translated = safetyOf(
        '{"resourceType":"Condition","verificationStatus":{"coding":[' +
          `{"system":"${CONDITION_VERIFICATION}","code":"refuted"},` +
          '{"system":"http://example.org/legacy","code":"REFUTED"}]}}',
      );
      expect(translated.negations).toEqual([REFUTED]);
      expect(translated.safeToSummarize).toBe(true);
    });

    it("leaves a `status` on a backbone element read by nothing", () => {
      // The window is inherited from the resource-root walk, so a near miss on a backbone element is
      // disclosed by nothing, exactly as an exact code there is read by nothing. A declared gap at
      // both states, not a claim that no document can sit at one.
      const safety = safetyOf(
        '{"resourceType":"Procedure","performer":[{"status":"NOT-DONE"}],"status":"completed"}',
      );

      expect(safety.negations).toEqual([]);
      expect(safety.safeToSummarize).toBe(true);
    });

    it("leaves `no-known-allergy` root-scoped, and its near miss undisclosed", () => {
      // `no-known-allergy` is the one negation whose surfacing can make a caller LESS careful: an
      // absent one reads as *unknown*, not as *none*. Its read is root- and type-scoped and
      // deliberately off the walk, so a near-miss disclosure at every resource root would report the
      // miss more loudly than the hit. Case cannot vary this code at all: it is digits.
      const coding = (code: string): string =>
        `{"resourceType":"AllergyIntolerance","code":{"coding":[{"system":"${SNOMED_SCT}","code":"${code}"}]}}`;

      const padded = safetyOf(coding(` ${NO_KNOWN_ALLERGY}`));
      expect(padded.noKnownAllergy).toBe(false);
      expect(padded.safeToSummarize).toBe(true);

      // The hit it is measured against: exact, but nested, and read by nothing at either state.
      const nested = safetyOf(bundleWith(coding(NO_KNOWN_ALLERGY)));
      expect(nested.noKnownAllergy).toBe(false);
      expect(nested.negations).toEqual([]);

      // And at the root it still reads, so nothing about that negation moved here.
      expect(safetyOf(coding(NO_KNOWN_ALLERGY)).noKnownAllergy).toBe(true);
    });

    it("leaves the boolean negation on the channel it already had", () => {
      // The pin that keeps this slice's claim honest: `do-not-perform` was ALREADY disclosed for a
      // value declined over case or padding. This slice is the code-valued half, not the first
      // disclosure of its kind, and saying otherwise would understate what the package already does.
      for (const value of ["TRUE", " true"]) {
        const safety = readSafety(
          parseResourceXml(
            `<MedicationRequest ${FHIR_NS}><doNotPerform value="${value}"/></MedicationRequest>`,
          ).resource,
        );
        expect(safety.negations).toEqual([]);
        expect(safety.unreadableBooleans).toEqual(["MedicationRequest.doNotPerform"]);
        expect(safety.safeToSummarize).toBe(false);
      }
    });

    it("raises no ValidationIssue of its own, exactly as the boolean channel does not", () => {
      // So this slice cannot move `valid` in either direction, on any document.
      expect(parseResource('{"resourceType":"Procedure","status":"NOT-DONE"}').issues).toEqual([]);
      expect(parseResource('{"resourceType":"Procedure","status":" not-done"}').issues).toEqual([]);
    });
  });

  describe("the disclosure covers exactly the pairs the read matches on", () => {
    it("classifies the exact code at every element the disclosure watches", () => {
      // The table is the one the matches are made from, so this is what stops it drifting into
      // describing a read that is not there: for each pair, the exact code IS a negation.
      for (const read of NEGATION_CODE_READS) {
        for (const code of read.codes) {
          const doc =
            read.element === "status"
              ? `{"resourceType":"Procedure","status":"${code}"}`
              : `{"resourceType":"Condition","verificationStatus":{"coding":[{"code":"${code}"}]}}`;
          expect(safetyOf(doc).negations.length).toBe(1);
          // ...and its case variant is disclosed at that same element.
          const varied = doc.replace(`"${code}"`, `"${code.toUpperCase()}"`);
          expect(safetyOf(varied).negations).toEqual([]);
          expect(safetyOf(varied).nearMissNegationCodes.length).toBe(1);
        }
      }
    });

    it("answers `false` for the code itself, which is what makes it a NEAR miss", () => {
      // The predicate's own contract, pinned directly. At its one call site the per-code suppression
      // would mask a break here, since a value equal to the code is a value the element spells
      // exactly and is suppressed anyway. That redundancy is deliberate defence in depth, and this
      // is what keeps it from rotting into a guard nothing checks.
      for (const read of NEGATION_CODE_READS) {
        for (const code of read.codes) {
          expect(isNearMissCode(code, code)).toBe(false);
          expect(isNearMissCode(code.toUpperCase(), code)).toBe(true);
          expect(isNearMissCode(` ${code}`, code)).toBe(true);
          expect(isNearMissCode(`${code}x`, code)).toBe(false);
        }
      }
    });

    it("names codes that are already folded, which the near-miss rule assumes", () => {
      for (const read of NEGATION_CODE_READS) {
        for (const code of read.codes) {
          expect(code).toBe(code.toLowerCase());
          expect(code).toBe(code.trim());
        }
      }
    });
  });

  describe("head-only: the declared limits, stated on the new channel itself", () => {
    // The both-states block above pins these documents through `safeToSummarize`, which exists at
    // both commits. These say the same thing about the channel by name, so a later change cannot
    // start filling it here while leaving the verdict alone.
    it("puts nothing on the channel for a near-miss `no-known-allergy`", () => {
      const padded = safetyOf(
        `{"resourceType":"AllergyIntolerance","code":{"coding":[{"system":"${SNOMED_SCT}","code":" ${NO_KNOWN_ALLERGY}"}]}}`,
      );
      expect(padded.nearMissNegationCodes).toEqual([]);
    });

    it("puts nothing on the channel for a boolean the boolean read declined", () => {
      // `doNotPerform` is not a `code`-valued element, so it is not in the table this channel is
      // derived from, and its own channel keeps it.
      const safety = readSafety(
        parseResourceXml(
          `<MedicationRequest ${FHIR_NS}><doNotPerform value="TRUE"/></MedicationRequest>`,
        ).resource,
      );
      expect(safety.nearMissNegationCodes).toEqual([]);
      expect(safety.unreadableBooleans).toEqual(["MedicationRequest.doNotPerform"]);
    });

    it("puts nothing on the channel for a code that is not near a negation", () => {
      for (const value of [" completed", "notdone", "not done", "\u00a0not-done"]) {
        const safety = safetyOf(`{"resourceType":"Procedure","status":${JSON.stringify(value)}}`);
        expect(safety.nearMissNegationCodes).toEqual([]);
      }
    });
  });
});
