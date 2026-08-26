/**
 * The shared-corpus FHIRPath measurement, and the gates over it.
 *
 * `test/_fhirpath-suite.ts` does the work; this file states what the run has to satisfy:
 *
 * 1. it **reports** how many of HL7's shared R4 cases the engine evaluates, declines and answers
 *    wrongly;
 * 2. a wrongly answered case **fails** the suite rather than being recorded as unsupported;
 * 3. every case the corpus carries lands in exactly one bucket and the buckets sum to the total;
 * 4. a case is only unsupported when the **engine itself** refused it;
 * 5. an input document that is missing, or that the reader refuses without a declaration, fails the
 *    run by name rather than having its cases skipped;
 * 6. the counts match `documentation/fhirpath-coverage.md`, naming both numbers when they do not;
 *    and
 * 7. the one exception to (2), a case the corpus marks invalid solely under a strictness mode this
 *    engine does not implement, applies **only** where the suite declares the case by name with its
 *    expression and the engine's answer, and fails the run the moment a declared case stops
 *    matching either.
 *
 * The corpus is HL7's, vendored under `__fixtures__/fhirpath-suite/` with its Apache-2.0 licence.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  answeredFraction,
  answeredFractionOfValid,
  appliedModeExceptions,
  classifyCase,
  COMMENTED_OUT_CASES,
  CORPUS_REPOSITORY,
  CORPUS_TAG,
  countBuckets,
  declaredLenientPolymorphicProblems,
  declaredRefusalProblems,
  inputDocumentNames,
  LENIENT_POLYMORPHIC_CASES,
  loadInputDocuments,
  modeExceptionProblem,
  RAW_TEST_TAG_OCCURRENCES,
  readCorpusFile,
  READER_REFUSED_INPUTS,
  readSuiteCases,
  REFUSED_INPUT_CASES,
  renderResult,
  runSuite,
  SUITE_FILE,
  TOTAL_CASES,
  typeQualifiedHeadCases,
  typeQualifiedHeadNames,
  UNIMPLEMENTED_MODES,
  type InputLoad,
  type SuiteCase,
} from "./_fhirpath-suite.js";
import { parseFhirPath, parseResource, UnsupportedFhirPathError } from "../src/index.js";
import { evaluate, focusCollection } from "../src/fhirpath/evaluate.js";

/** One run, shared by every assertion below (the corpus is 935 cases; run it once). */
const RUN = runSuite();

/** The committed coverage record, read as text. */
const RECORD_PATH = new URL("../documentation/fhirpath-coverage.md", import.meta.url);
const RECORD = readFileSync(RECORD_PATH, "utf8");

/**
 * The one live case the corpus writes under `name`.
 *
 * Throws rather than returning `undefined` when the corpus stops carrying it, or carries it twice,
 * so an assertion resting on a named case cannot pass vacuously after an upstream edit.
 */
function byNameInRun(name: string): SuiteCase {
  const found = RUN.cases.filter((c) => c.name === name);
  if (found.length !== 1) {
    throw new Error(
      `the vendored corpus carries ${String(found.length)} case(s) called '${name}', expected 1`,
    );
  }
  return found[0] as SuiteCase;
}

/** The record's machine-checked `counts` block, as `key -> value`. */
function recordedCounts(): Map<string, string> {
  const block = /```counts\n([\s\S]*?)```/.exec(RECORD);
  if (block?.[1] === undefined) {
    throw new Error(
      "documentation/fhirpath-coverage.md carries no ```counts block; the suite has nothing to check the run against",
    );
  }
  const out = new Map<string, string>();
  for (const line of block[1].split("\n")) {
    const at = line.indexOf(":");
    if (at < 0) continue;
    out.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return out;
}

/** `sha256 -> vendored file name` as the record's provenance table states it. */
function recordedDigests(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of RECORD.matchAll(
    /^\|\s*`[^`]+`\s*\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*`([0-9a-f]{64})`\s*\|$/gm,
  )) {
    const [, file, bytes, sha] = m;
    if (file !== undefined && bytes !== undefined && sha !== undefined) {
      out.set(file, `${bytes}:${sha}`);
    }
  }
  return out;
}

/** Assert a recorded value against the measured one, naming both. */
function expectNoDrift(key: string, measured: string | number): void {
  const recorded = recordedCounts().get(key);
  expect(
    recorded,
    `documentation/fhirpath-coverage.md records no '${key}'; the measured value is ${String(measured)}`,
  ).toBeDefined();
  expect(
    recorded,
    `documentation/fhirpath-coverage.md records ${key}=${String(recorded)}, the run measured ${String(measured)}`,
  ).toBe(String(measured));
}

describe("the shared R4 FHIRPath suite: what the bounded engine covers", () => {
  it("reports how many shared cases it evaluates, declines as unsupported, and answers wrongly", () => {
    const { counts } = RUN;
    // The report itself. `pnpm run test` prints it, which is the whole point of the measurement.
    process.stdout.write(
      `\n[fhirpath-suite] ${CORPUS_REPOSITORY} @ ${CORPUS_TAG}\n` +
        `[fhirpath-suite] total ${String(counts.total)} | evaluated ${String(counts.evaluated)} | ` +
        `unsupported ${String(counts.unsupported)} | wrong ${String(counts.wrong)} | ` +
        `invalid ${String(counts.invalid)}\n` +
        `[fhirpath-suite] answered ${answeredFraction(counts)} of the corpus, ` +
        `${answeredFractionOfValid(counts)} of the cases it expects to evaluate\n`,
    );
    expect(counts.evaluated).toBeGreaterThan(0);
    expect(counts.unsupported).toBeGreaterThan(0);
    expect(counts.total).toBe(TOTAL_CASES);
  });

  it("fails on a wrongly answered case rather than recording it as unsupported", () => {
    const wrong = RUN.results.filter((r) => r.bucket === "wrong");
    const named = wrong
      .map((r) => `  ${r.testCase.group}/${r.testCase.name}: ${r.detail}`)
      .join("\n");
    expect(
      wrong.length,
      `the engine answered ${String(wrong.length)} shared case(s) wrongly:\n${named}\n` +
        `A wrong answer is not an unsupported one. Either make the engine refuse the construct, or ` +
        `correct an answer for a construct the subset already claims to support.`,
    ).toBe(0);
  });

  it("puts every case the corpus carries in exactly one bucket, and the buckets sum to the total", () => {
    const { counts, results } = RUN;
    // The byte count and the live count reconciled, so neither can drift in silence. Both halves are
    // MEASURED off the bytes: the total `<test` occurrences, and how many of them sit inside a
    // comment. Counting the commented ones directly, rather than stripping the comments and
    // re-counting, keeps this a measurement of the corpus and not a rewrite of it.
    const raw = readCorpusFile(SUITE_FILE);
    const tagsIn = (text: string): number => (text.match(/<test[\s]/g) ?? []).length;
    const commented = (raw.match(/<!--[\s\S]*?-->/g) ?? []).reduce((n, c) => n + tagsIn(c), 0);
    expect(tagsIn(raw)).toBe(RAW_TEST_TAG_OCCURRENCES);
    expect(commented).toBe(COMMENTED_OUT_CASES);
    expect(RAW_TEST_TAG_OCCURRENCES - COMMENTED_OUT_CASES).toBe(TOTAL_CASES);

    expect(results.length).toBe(TOTAL_CASES);
    expect(counts.evaluated + counts.unsupported + counts.wrong + counts.invalid).toBe(TOTAL_CASES);
    // "Exactly one" is the bucket being a single field, but the case identities have to be distinct
    // too, or two results for one case would still sum correctly. The identity is the position, not
    // the name: the corpus writes `testEquivalent23` twice in one group, so a name-keyed tally would
    // merge two cases and never say so.
    expect(new Set(results.map((r) => r.testCase.index)).size).toBe(TOTAL_CASES);
    const names = RUN.cases.map((c) => `${c.group}/${c.name}`);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([
      "testEquivalent/testEquivalent23",
    ]);
  });

  it("counts a case unsupported only where the evaluator itself refused the expression", () => {
    const unsupported = RUN.results.filter((r) => r.bucket === "unsupported");
    expect(unsupported.length).toBeGreaterThan(0);
    const notRefused: string[] = [];
    for (const result of unsupported) {
      const load =
        result.testCase.inputFile === null ? undefined : RUN.loads.get(result.testCase.inputFile);
      const document = load?.kind === "loaded" ? load.resource : null;
      let refused = false;
      try {
        const focus = document === null ? [] : focusCollection(document);
        evaluate(parseFhirPath(result.testCase.expression), focus, {
          resource: document ?? { kind: "complex", properties: [] },
          context: focus,
        });
      } catch (err) {
        refused = err instanceof UnsupportedFhirPathError;
      }
      if (!refused) notRefused.push(`${result.testCase.group}/${result.testCase.name}`);
    }
    expect(
      notRefused,
      `these cases are counted unsupported but the engine does not refuse them: ${notRefused.join(", ")}`,
    ).toEqual([]);
  });

  it("counts a result it cannot compare as wrongly answered, never as unsupported", () => {
    // A complex element has no scalar reading, so the harness cannot compare it to a string output.
    const uncomparable: SuiteCase = {
      index: -1,
      group: "(harness self-test)",
      name: "uncomparable",
      inputFile: "patient-example.xml",
      expression: "name",
      mode: null,
      invalid: null,
      predicate: false,
      ordered: null,
      outputs: [{ type: "string", text: "Chalmers" }],
    };
    const result = classifyCase(uncomparable, RUN.loads);
    expect(result.bucket).toBe("wrong");

    // Same for an output type this engine has no item shape for at all.
    const quantity: SuiteCase = { ...uncomparable, name: "quantity-output", expression: "active" };
    expect(
      classifyCase({ ...quantity, outputs: [{ type: "Quantity", text: "4 'kg'" }] }, RUN.loads)
        .bucket,
    ).toBe("wrong");
  });

  it("reports a case the corpus marks invalid in its own bucket, never among the evaluated", () => {
    const { counts, results } = RUN;
    expect(counts.invalid).toBeGreaterThan(0);
    const marked = RUN.cases.filter((c) => c.invalid !== null && c.invalid !== "false");
    expect(marked.length).toBeGreaterThan(0);
    // No case the corpus marks invalid is ever counted as evaluated or unsupported: it is either in
    // the invalid bucket, or it is wrong for having produced an answer.
    for (const result of results) {
      const isMarked = result.testCase.invalid !== null && result.testCase.invalid !== "false";
      if (isMarked) expect(["invalid", "wrong"]).toContain(result.bucket);
      else expect(result.bucket).not.toBe("invalid");
    }
    // The invalid bucket holds every marked case except the ones the engine answered non-empty,
    // which the previous clause sends to `wrong` instead: the two counts partition the marked set,
    // and nothing outside it reaches either.
    const markedResults = results.filter(
      (r) => r.testCase.invalid !== null && r.testCase.invalid !== "false",
    );
    expect(markedResults.length).toBe(marked.length);
    expect(counts.invalid).toBe(markedResults.filter((r) => r.bucket === "invalid").length);
    expect(counts.invalid + markedResults.filter((r) => r.bucket === "wrong").length).toBe(
      marked.length,
    );
    // Every live case spells `invalid` as an error kind; none spells the schema's "false", so
    // "carries the attribute" and "expects an error" name the same set here, and the reading the
    // harness took ("carries the attribute") is provably not load-bearing.
    expect(new Set(marked.map((c) => c.invalid))).toEqual(
      new Set(["syntax", "semantic", "execution"]),
    );
    expect(RUN.cases.filter((c) => c.invalid === "false")).toEqual([]);
  });

  it("counts a non-empty result for a case the corpus marks invalid as wrongly answered", () => {
    const nonEmpty: SuiteCase = {
      index: -1,
      group: "(harness self-test)",
      name: "invalid-but-answered",
      inputFile: "patient-example.xml",
      expression: "active",
      mode: null,
      invalid: "semantic",
      predicate: false,
      ordered: null,
      outputs: [],
    };
    expect(classifyCase(nonEmpty, RUN.loads).bucket).toBe("wrong");
    // An empty result on the same marked case is the honest outcome and stays in the invalid bucket.
    expect(classifyCase({ ...nonEmpty, expression: "noSuchElement" }, RUN.loads).bucket).toBe(
      "invalid",
    );
  });

  it("fails naming an input document the corpus carries that is missing or unreadable", () => {
    // The live gate over this run: nothing missing, nothing refused that is not declared.
    expect(declaredRefusalProblems(RUN.loads)).toEqual([]);
    expect(inputDocumentNames(RUN.cases).length).toBe(11);
    for (const name of inputDocumentNames(RUN.cases)) {
      expect(RUN.loads.get(name), `input document '${name}' was never loaded`).toBeDefined();
    }

    // And the gate really fires: a missing document, and an undeclared refusal, are both named.
    const missing = new Map<string, InputLoad>([
      ["not-vendored.json", { kind: "missing", reason: "not vendored" }],
      [
        "surprise.json",
        { kind: "refused", fatalCode: "SOME_FATAL", reason: "the reader refused it" },
      ],
    ]);
    const problems = declaredRefusalProblems(missing);
    expect(problems.some((p) => p.startsWith("not-vendored.json:"))).toBe(true);
    expect(problems.some((p) => p.startsWith("surprise.json:"))).toBe(true);
  });

  it("keeps the one declared reader refusal honest in both directions", () => {
    // The declaration is not a bypass: the document must still be refused, under the exact fatal
    // code recorded, and the cases naming it must still be scored on an observed engine refusal.
    expect([...READER_REFUSED_INPUTS.keys()]).toEqual(["patient-name-extensions.json"]);
    const load = RUN.loads.get("patient-name-extensions.json");
    expect(load?.kind).toBe("refused");
    expect(load?.kind === "refused" ? load.fatalCode : "").toBe("PRIMITIVE_EXTENSION_MISALIGNED");
    // The published document really is the misaligned shape, not a fetch accident.
    expect(() => parseResource(readCorpusFile("patient-name-extensions.json"))).toThrow(
      /different lengths/,
    );

    const naming = RUN.results.filter(
      (r) => r.testCase.inputFile !== null && READER_REFUSED_INPUTS.has(r.testCase.inputFile),
    );
    expect(naming.map((r) => r.testCase.name)).toEqual([...REFUSED_INPUT_CASES.keys()]);
    for (const result of naming) {
      expect(result.bucket).toBe("unsupported");
      // The refusal is the engine's own, on the expression as the harness can pose it: with no
      // readable document there is no focus, and an empty focus is nothing to check a type
      // qualifier against. It is caused by the absent document rather than independent of it, which
      // is why the placement is argued as conservative (a case counted declined can only shrink the
      // coverage number) and not as a measurement. Pinning the message keeps it to this one case.
      expect(() =>
        evaluate(parseFhirPath(result.testCase.expression), [], {
          resource: { kind: "complex", properties: [] },
          context: [],
        }),
      ).toThrow(REFUSED_INPUT_CASES.get(result.testCase.name));
    }
    // And the honest statement of what that costs: exactly one case in the whole corpus, and it is
    // counted in the direction that cannot flatter the engine.
    expect(naming.length).toBe(1);
  });

  it("counts a declared strictness-mode difference in the invalid bucket, and only while it is declared", () => {
    // What the corpus itself calls a MODE: `testSchema.xsd` documents `mode` as strict-versus-lenient
    // choice-element access, and the corpus's own comment above the `polymorphics` group says some
    // engines are lenient there. This one is, and it has no strict mode to select. These two cases
    // are therefore marked invalid SOLELY under a mode this engine does not implement, which is the
    // single exception C7 admits, and it applies only where the suite declares the case by name with
    // its expression and the engine's answer.
    expect([...LENIENT_POLYMORPHIC_CASES.keys()]).toEqual([
      "testPolymorphismB",
      "testPolymorphicsB",
    ]);
    expect([...UNIMPLEMENTED_MODES]).toEqual(["strict"]);
    expect(declaredLenientPolymorphicProblems(RUN.cases, RUN.loads)).toEqual([]);

    // Both land in the invalid bucket under the exception, neither is credited to the engine as
    // evaluated, and neither is filed as unsupported.
    const declared = RUN.results.filter((r) => LENIENT_POLYMORPHIC_CASES.has(r.testCase.name));
    expect(declared.map((r) => r.bucket)).toEqual(["invalid", "invalid"]);
    expect(declared.map((r) => r.modeException)).toEqual([true, true]);
    // And they are the ONLY cases the exception moves, so the reported `wrong` count is qualified by
    // exactly these two and nothing else.
    expect(appliedModeExceptions(RUN.results)).toEqual([
      {
        name: "testPolymorphismB",
        expression: "Observation.valueQuantity.unit",
        answer: "lbs",
        grounds: "the case carries mode='strict'",
      },
      {
        name: "testPolymorphicsB",
        expression: "Observation.valueQuantity.exists()",
        answer: "true",
        grounds: "the corpus's 'polymorphics' group comment documents the non-strict mode",
      },
    ]);

    // The corpus really does ground both, and it is read off the vendored bytes rather than asserted
    // here: one case carries `mode="strict"` itself, the other sits under the group comment.
    expect(byNameInRun("testPolymorphismB").mode).toBe("strict");
    expect(byNameInRun("testPolymorphicsB").group).toBe("polymorphics");
    expect(readCorpusFile(SUITE_FILE)).toContain(
      "some engines have a non-strict mode where this is allowed",
    );

    // The gate fires in every direction. A declaration for a case the corpus does not carry, one
    // whose expression has moved, one that stops being marked invalid, and one whose mode grounds
    // stop holding, are each named.
    expect(
      declaredLenientPolymorphicProblems(
        RUN.cases.filter((c) => c.name !== "testPolymorphismB"),
        RUN.loads,
      ).some((p) => p.startsWith("testPolymorphismB:")),
    ).toBe(true);
    const edited = RUN.cases.map((c) =>
      c.name === "testPolymorphicsB" ? { ...c, expression: "Observation.value.exists()" } : c,
    );
    expect(
      declaredLenientPolymorphicProblems(edited, RUN.loads).some((p) =>
        p.startsWith("testPolymorphicsB:"),
      ),
    ).toBe(true);
    const unmarked = RUN.cases.map((c) =>
      c.name === "testPolymorphicsB" ? { ...c, invalid: null } : c,
    );
    expect(
      declaredLenientPolymorphicProblems(unmarked, RUN.loads).some((p) =>
        p.includes("no longer marks it invalid"),
      ),
    ).toBe(true);
    const demoded = RUN.cases.map((c) =>
      c.name === "testPolymorphismB" ? { ...c, mode: null } : c,
    );
    expect(
      declaredLenientPolymorphicProblems(demoded, RUN.loads).some((p) =>
        p.includes("no mode attribute"),
      ),
    ).toBe(true);
  });

  it("takes the exception away the moment a declared case stops matching what was pinned for it", () => {
    // This is the other half of C7 and the reason the exception is safe: the bucket move is not a
    // property of the NAME, it is a property of the name still describing the case and the answer.
    // Every clause below is checked at `classifyCase`, so a stale declaration reds the run through
    // the wrong count as well as through `declaredLenientPolymorphicProblems`.
    const undeclared: SuiteCase = {
      index: -1,
      group: "(harness self-test)",
      name: "not-declared",
      inputFile: "observation-example.xml",
      expression: "Observation.valueQuantity.unit",
      mode: "strict",
      invalid: "semantic",
      predicate: false,
      ordered: null,
      outputs: [],
    };
    // An undeclared case is wrong even where it would otherwise qualify: carrying `mode="strict"` is
    // not enough, the suite has to have declared the case.
    const notDeclared = classifyCase(undeclared, RUN.loads);
    expect(notDeclared.bucket).toBe("wrong");
    expect(notDeclared.modeException).toBeUndefined();
    expect(notDeclared.detail).toContain("not declared in LENIENT_POLYMORPHIC_CASES");

    // A declared name whose expression has moved is wrong: the declaration is for an expression.
    const movedExpression = classifyCase(
      { ...undeclared, name: "testPolymorphismB", expression: "Observation.value.unit" },
      RUN.loads,
    );
    expect(movedExpression.bucket).toBe("wrong");
    expect(movedExpression.detail).toContain("Observation.valueQuantity.unit");

    // A declared name whose mode grounds no longer hold is wrong: the case has to still be one the
    // corpus marks invalid only under the unimplemented mode.
    const noMode = classifyCase(
      { ...undeclared, name: "testPolymorphismB", mode: null },
      RUN.loads,
    );
    expect(noMode.bucket).toBe("wrong");
    expect(noMode.detail).toContain("no mode attribute");
    const wrongGroup = classifyCase(
      {
        ...undeclared,
        name: "testPolymorphicsB",
        expression: "Observation.valueQuantity.exists()",
        group: "somewhere-else",
      },
      RUN.loads,
    );
    expect(wrongGroup.bucket).toBe("wrong");
    expect(wrongGroup.detail).toContain("somewhere-else");

    // And a declared case whose ANSWER has moved is wrong, proved end to end by handing the harness
    // an Observation whose quantity carries a different unit. Nothing about the declaration changes;
    // the engine answers `kg` where `lbs` was pinned, and the case leaves the invalid bucket.
    const doctored = new Map(RUN.loads);
    doctored.set("observation-example.xml", {
      kind: "loaded",
      resource: parseResource(
        JSON.stringify({
          resourceType: "Observation",
          status: "final",
          code: { text: "synthetic" },
          valueQuantity: { value: 1, unit: "kg" },
        }),
      ).resource,
    });
    const movedAnswer = classifyCase({ ...undeclared, name: "testPolymorphismB" }, doctored);
    expect(movedAnswer.bucket).toBe("wrong");
    expect(movedAnswer.detail).toContain("declared answer 'lbs'");
    // The same clause read directly, so the reason is pinned and not just the bucket.
    expect(
      modeExceptionProblem(byNameInRun("testPolymorphismB"), [{ t: "str", value: "kg" }]),
    ).toContain("the engine answers 'kg'");
    expect(
      modeExceptionProblem(byNameInRun("testPolymorphismB"), [{ t: "str", value: "lbs" }]),
    ).toBeNull();
    expect(renderResult([{ t: "bool", value: true }])).toBe("true");
  });

  it("matches the committed coverage record, naming both numbers on drift", () => {
    const { counts } = RUN;
    expectNoDrift("corpus_repository", CORPUS_REPOSITORY);
    expectNoDrift("corpus_tag", CORPUS_TAG);
    expectNoDrift("raw_test_tag_occurrences", RAW_TEST_TAG_OCCURRENCES);
    expectNoDrift("commented_out_cases", COMMENTED_OUT_CASES);
    expectNoDrift("total_cases", counts.total);
    expectNoDrift("evaluated", counts.evaluated);
    expectNoDrift("unsupported", counts.unsupported);
    expectNoDrift("wrong", counts.wrong);
    expectNoDrift("invalid", counts.invalid);
    expectNoDrift("answered_fraction", answeredFraction(counts));
    expectNoDrift("answered_fraction_of_valid", answeredFractionOfValid(counts));
    // The record states how many cases are written type-qualified, and its own opening line promises
    // every number in it is re-derived here. It is, and so is the list of heads that makes "the
    // leading segment names a type" checkable rather than asserted.
    expectNoDrift("type_qualified_head_cases", typeQualifiedHeadCases(RUN.cases));
    expectNoDrift("type_qualified_head_names", typeQualifiedHeadNames(RUN.cases));
  });

  it("names in the record every case the reported wrong count leaves out", () => {
    // The reported `wrong` count means "wrong outside a declared mode difference", so the record has
    // to say which cases that qualification covers, and say out loud that they are excluded. Checked
    // against the RUN rather than against the declaration: what the record owes is a description of
    // what this measurement actually did.
    const applied = appliedModeExceptions(RUN.results);
    const lines = RECORD.split("\n");
    for (const exception of applied) {
      const line = lines.find(
        (l) =>
          l.includes(exception.name) &&
          l.includes(exception.expression) &&
          l.includes(exception.answer),
      );
      expect(
        line,
        `documentation/fhirpath-coverage.md carries no single line naming '${exception.name}' ` +
          `with its expression '${exception.expression}' and the engine's answer ` +
          `'${exception.answer}'. C7 counts that case in the invalid bucket instead of wrong, so ` +
          `the record has to name it, its expression and the answer.`,
      ).toBeDefined();
    }
    if (applied.length > 0) {
      expect(
        /wrongly[ -]answered count excludes/i.test(RECORD),
        `documentation/fhirpath-coverage.md reports wrong=${String(RUN.counts.wrong)} while ` +
          `${String(applied.length)} case(s) were counted invalid under a declared mode ` +
          `difference, and it never says the wrongly answered count excludes them.`,
      ).toBe(true);
    }
  });

  it("records the sha256 and byte count of every vendored file, and they still hold", () => {
    const digests = recordedDigests();
    const names = [
      ...new Set([...inputDocumentNames(RUN.cases), SUITE_FILE, "testSchema.xsd", "LICENSE.txt"]),
    ];
    expect(digests.size).toBe(names.length);
    for (const name of names) {
      const recorded = digests.get(name);
      expect(
        recorded,
        `documentation/fhirpath-coverage.md records no sha256 for '${name}'`,
      ).toBeDefined();
      const bytes = readFileSync(new URL(`./__fixtures__/fhirpath-suite/${name}`, import.meta.url));
      const measured = `${String(bytes.length)}:${createHash("sha256").update(bytes).digest("hex")}`;
      expect(
        measured,
        `documentation/fhirpath-coverage.md records ${String(recorded)} for '${name}', the file on disk is ${measured}`,
      ).toBe(recorded);
    }
  });

  it("carries the upstream Apache-2.0 licence beside the vendored bytes", () => {
    const licence = readCorpusFile("LICENSE.txt");
    expect(licence).toContain("Apache License");
    expect(licence).toContain("Version 2.0, January 2004");
  });

  it("reads the corpus as the vendored schema describes it", () => {
    const cases = readSuiteCases();
    expect(cases.length).toBe(TOTAL_CASES);
    // A case with no `<output>` expects the empty collection; one with several expects them in order
    // unless it says otherwise. Both shapes are present, so neither rule is untested by accident.
    expect(cases.some((c) => c.outputs.length === 0)).toBe(true);
    expect(cases.some((c) => c.outputs.length > 1)).toBe(true);
    expect(cases.some((c) => c.ordered === false)).toBe(true);
    expect(cases.some((c) => c.predicate)).toBe(true);
    // The schema says an `<output>` with no `type` carries a literal's string form.
    expect(cases.some((c) => c.outputs.some((o) => o.type === null))).toBe(true);
    // Every declared type the corpus uses is one the schema enumerates.
    const declared = new Set(
      cases.flatMap((c) => c.outputs.map((o) => o.type)).filter((t): t is string => t !== null),
    );
    for (const type of declared) {
      expect([
        "boolean",
        "code",
        "date",
        "dateTime",
        "decimal",
        "id",
        "integer",
        "Quantity",
        "string",
        "time",
      ]).toContain(type);
    }
  });

  it("loads each input document once, and re-running is stable", () => {
    const names = inputDocumentNames(RUN.cases);
    const again = loadInputDocuments(names);
    expect([...again.keys()].sort()).toEqual([...names].sort());
    expect(countBuckets(RUN.cases.map((c) => classifyCase(c, again)))).toEqual(RUN.counts);
  });
});
