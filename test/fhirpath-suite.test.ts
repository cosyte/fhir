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
 *    run by name rather than having its cases skipped; and
 * 6. the counts match `documentation/fhirpath-coverage.md`, naming both numbers when they do not.
 *
 * The corpus is HL7's, vendored under `__fixtures__/fhirpath-suite/` with its Apache-2.0 licence.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  answeredFraction,
  answeredFractionOfValid,
  classifyCase,
  COMMENTED_OUT_CASES,
  CORPUS_REPOSITORY,
  CORPUS_TAG,
  countBuckets,
  declaredRefusalProblems,
  inputDocumentNames,
  loadInputDocuments,
  RAW_TEST_TAG_OCCURRENCES,
  readCorpusFile,
  READER_REFUSED_INPUTS,
  readSuiteCases,
  REFUSED_INPUT_CASES,
  runSuite,
  SUITE_FILE,
  TOTAL_CASES,
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
    // The byte count and the live count reconciled, so neither can drift in silence.
    const raw = readCorpusFile(SUITE_FILE);
    expect(raw.match(/<test[\s]/g)?.length ?? 0).toBe(RAW_TEST_TAG_OCCURRENCES);
    expect(raw.replace(/<!--[\s\S]*?-->/g, "").match(/<test[\s]/g)?.length ?? 0).toBe(TOTAL_CASES);
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
    expect(counts.invalid).toBe(marked.length);
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
      // Document-independent: the refusal is raised at the head of the path, so it is the same with
      // no focus at all, which is what makes counting it unsupported honest.
      expect(() =>
        evaluate(parseFhirPath(result.testCase.expression), [], {
          resource: { kind: "complex", properties: [] },
          context: [],
        }),
      ).toThrow(REFUSED_INPUT_CASES.get(result.testCase.name));
    }
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
