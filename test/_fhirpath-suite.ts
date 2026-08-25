/**
 * The shared-corpus FHIRPath harness: read HL7's published R4 test suite, run every case through
 * this package's bounded engine, and put each case in exactly one bucket.
 *
 * This module is the measurement; `fhirpath-suite.test.ts` is the assertions over it. It exists to
 * turn a claim into a number. `src/fhirpath/` is a deliberately capped subset (ADR 0002) whose
 * declared fallback is `INVARIANT_UNCHECKED`, and until this landed nothing in the repo had ever
 * measured how big that subset is against a suite neither side wrote.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * THE FOUR BUCKETS, AND WHY THE BOUNDARIES SIT WHERE THEY DO
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * - **`invalid`** - the case's own `<expression invalid="…">` says the expression is not meant to
 *   evaluate at all (a syntax / semantic / execution error is the expected outcome). These are not
 *   cases the engine gets credit for, so they are never counted among the ones it evaluates. A case
 *   here that the engine answers with a **non-empty** collection has manufactured an answer where
 *   the suite says there is none, and moves to `wrong`. **Without exception**, including the two
 *   cases {@link LENIENT_POLYMORPHIC_CASES} names, which the corpus marks invalid only under a
 *   *strict* mode of choice-element access that this engine does not implement. Those two are what
 *   `wrong` currently counts, and the suite reds over them on purpose: the honest number is the one
 *   that says an engine which answers a case the corpus calls invalid answered it.
 * - **`unsupported`** - the engine itself raised {@link UnsupportedFhirPathError}. **Only** that.
 *   A harness that cannot read a case, cannot compare a result, or catches some other error must
 *   never land here: "unsupported" is a statement about the engine's refusal, and inflating it with
 *   the harness's own gaps is exactly how an asserted subset size stays unmeasured.
 * - **`wrong`** - the engine produced an answer and the answer disagrees with the corpus, or the
 *   harness could not compare the two, or the engine threw something that is not a refusal. A wrong
 *   answer is worse than a refusal (the whole fail-safe contract in `src/fhirpath/errors.ts` is that
 *   the engine never guesses), so an uncomparable result counts here rather than being quietly
 *   dropped or filed as unsupported.
 * - **`evaluated`** - the engine produced an answer and it matches.
 *
 * Every live `<test>` element lands in exactly one of the four. The suite fails when they do not sum
 * to the corpus total, when `wrong` is non-zero, or when any count drifts from the committed record.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS HARNESS DOES **NOT** DO
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * It does not widen the subset, and it does not soften a comparison to flatter it. The engine's
 * scope is fixed by ADR 0002; this file only reports where the boundary actually is.
 */

import { readFileSync } from "node:fs";

import {
  convertToBoolean,
  FATAL_CODES,
  FhirCodecError,
  parseFhirPath,
  parseResource,
  parseResourceXml,
  readRawXml,
  UnsupportedFhirPathError,
  type FhirComplex,
  type XmlElement,
  type XmlNode,
} from "../src/index.js";
import { evaluate, focusCollection, type FpColl, type FpItem } from "../src/fhirpath/evaluate.js";
import { FhirDecimal } from "../src/model/decimal.js";
import { isPrimitive } from "../src/model/node.js";

/** The corpus repository the vendored bytes came from. */
export const CORPUS_REPOSITORY = "https://github.com/FHIR/fhir-test-cases";

/** The corpus tag the vendored bytes were taken at. Every count below is measured at this tag. */
export const CORPUS_TAG = "1.7.67";

/** The vendored suite file's name under `test/__fixtures__/fhirpath-suite/`. */
export const SUITE_FILE = "tests-fhir-r4.xml";

/**
 * `<test …>` occurrences in the vendored suite file **counted as bytes**, including the two that sit
 * inside XML comments and are therefore not elements. Recorded because it is the number a reader
 * gets from `grep -c '<test '` on the corpus, and reconciling it here is what stops the live count
 * below looking like a transcription slip. See {@link COMMENTED_OUT_CASES}.
 */
export const RAW_TEST_TAG_OCCURRENCES = 937;

/**
 * `<test …>` occurrences the corpus author commented out. Both sit inside `<!-- … -->` blocks: a
 * `testMatchesUnicodeCharacters` case parked whole, and an unnamed leftover inside a commented
 * `testDollarResource` group. No XML reader produces either, and no engine is asked to answer them,
 * so they are not cases the corpus carries.
 */
export const COMMENTED_OUT_CASES = 2;

/** Live `<test>` elements in the vendored suite: every case an XML reader actually yields. */
export const TOTAL_CASES = RAW_TEST_TAG_OCCURRENCES - COMMENTED_OUT_CASES;

/**
 * An input document the corpus names that **this package's reader refuses**, declared one file at a
 * time with the fatal code it refuses under.
 *
 * A missing or unreadable input document normally FAILS the run, by name: skipping the cases that
 * name it would silently shrink the measurement, which is the one thing a coverage number must never
 * do. This map is the single sanctioned exception, and it is a declaration rather than a bypass:
 * {@link declaredRefusalProblems} checks it in **both** directions, so a document that starts
 * failing without a line here reds the suite naming itself, and a declared document that becomes
 * readable reds the suite too and the line must then be deleted.
 *
 * The one entry is not a defect in this package. `patient-name-extensions.json` writes
 * `"given": [null, "James"]` beside `"_given": [ { … } ]`, a two-slot value array against a one-slot
 * `_`-sibling array. FHIR json.html §2.6.2.3 fills out **both** arrays so the `id`/`extension` line
 * up index by index with the values, so the published example is non-conformant, and this reader
 * fails closed on exactly that shape by design rather than re-index or drop a position
 * (`test/underscore-sibling.test.ts` pins it). Loosening the reader to admit the document is
 * forbidden here: it would retire a finding a shipped layer emits today.
 */
export const READER_REFUSED_INPUTS: ReadonlyMap<string, string> = new Map([
  ["patient-name-extensions.json", FATAL_CODES.PRIMITIVE_EXTENSION_MISALIGNED],
]);

/**
 * The cases that name a {@link READER_REFUSED_INPUTS} document, and the exact refusal the engine
 * answers each with when it is asked with no focus at all.
 *
 * **Read this as the conservative placement it is, not as a measurement of the engine.** With no
 * readable document there is no focus, and `Patient.name.given.select(…)` over an empty focus is
 * refused at the head of the path because an empty focus is nothing to check a type qualifier
 * against. That refusal is *caused by* the absent document: handed the Patient the corpus meant,
 * the engine would resolve the qualifier and answer. So this case is credited `unsupported`
 * although the engine's real coverage of it is unknown.
 *
 * That is the safe direction and it is the only reason the placement is defensible: a case counted
 * declined can only make the coverage number **smaller** than the engine deserves, never larger.
 * The alternative placements are worse. `evaluated` would credit an answer nobody has seen;
 * `wrong` would attribute a correct reader refusal to the evaluator and red the suite permanently
 * over this package behaving as designed; skipping it is what C8 forbids outright.
 *
 * Pinning the message is what keeps the placement narrow: exactly one case, one expression, one
 * refusal, and anything else the engine does with it counts `wrong`. The message is value-free by
 * the error class's own contract.
 */
export const REFUSED_INPUT_CASES: ReadonlyMap<string, string> = new Map([
  ["testPrimitiveExtensions", "type-qualified path head 'Patient'"],
]);

/** A case the corpus marks invalid only under a mode this engine does not run in. */
export interface LenientPolymorphicCase {
  /** The expression, verbatim, so the declaration cannot outlive the case it was written for. */
  readonly expression: string;
  /** The answer this engine gives, rendered by {@link renderResult}, pinned so it cannot drift. */
  readonly answer: string;
}

/**
 * The two cases the corpus marks invalid **only under strict polymorphic semantics**, which is a
 * FHIRPath *mode* rather than a fact about the expression. They are the whole of what `wrong`
 * currently counts, and naming them here is a description of the gap, **not an exception to it**:
 * {@link classifyCase} counts a non-empty answer to a case marked invalid as `wrong` whether or not
 * it is named here, so the suite fails over these two.
 *
 * The vendored `testSchema.xsd` defines a `mode` attribute as "whether the test should be evaluated
 * with strict (e.g. `Patient.deceased`) as opposed to lenient (e.g. `Patient.deceasedBoolean`)
 * semantics", and the corpus's own comment above the `polymorphics` group says the direct spelling
 * "is not technical conformant. For this reason, **some engines have a non-strict mode where this is
 * allowed**". This engine is one of those: `navigateItem` takes an exact property before it tries a
 * `[x]` choice variant, so `Observation.valueQuantity` selects the element the document wrote.
 *
 * **Being strict here is not a thing this engine can currently choose to be**, which is why the gap
 * is declared rather than closed. Telling `valueQuantity` (a choice element, spelled with its type)
 * from `birthDate` or `managingOrganization` (ordinary elements that are also lowerCamelCase with an
 * internal capital) needs the FHIR *definition* of the resource. The model is generic and carries
 * none, which is the same reason FHIR-type `is` / `as` is out of scope under ADR 0002, and the
 * built-in element schema in `src/validate/schema.ts` models `Patient` alone, so it cannot answer it
 * for `Observation` either. Refusing every internally-capitalised member name instead would withdraw
 * `Patient.birthDate` and `Extension.valueString` from every caller-supplied invariant that uses
 * them, which is the direction the fail-safe contract forbids.
 *
 * So the declaration is a tripwire, checked in both directions by
 * {@link declaredLenientPolymorphicProblems}: the case must still exist, still carry the `invalid`
 * attribute, still spell that exact expression, and still produce that exact answer. If the engine
 * ever refuses one of them, or the corpus stops marking it invalid, the gate says so and the line
 * comes out.
 */
export const LENIENT_POLYMORPHIC_CASES: ReadonlyMap<string, LenientPolymorphicCase> = new Map([
  ["testPolymorphismB", { expression: "Observation.valueQuantity.unit", answer: "lbs" }],
  ["testPolymorphicsB", { expression: "Observation.valueQuantity.exists()", answer: "true" }],
]);

/** Which bucket a case landed in. Exactly one per case. */
export type Bucket = "evaluated" | "unsupported" | "wrong" | "invalid";

/** One expected result the corpus states for a case. */
export interface ExpectedOutput {
  /**
   * The declared `type` attribute, or `null` when the corpus omitted it. Per the vendored
   * `testSchema.xsd`, an absent type means "the content of the output is the string representation
   * of a literal".
   */
  readonly type: string | null;
  /** The literal text content of the `<output>` element. */
  readonly text: string;
}

/** One case from the corpus, read straight out of the suite file. */
export interface SuiteCase {
  /**
   * The case's 0-based position in the suite file. This, not the name, is a case's identity: the
   * corpus writes `testEquivalent23` **twice** in one group, so a name-keyed tally would silently
   * merge two cases and still sum correctly.
   */
  readonly index: number;
  /** The enclosing `<group name="…">`, for reporting. */
  readonly group: string;
  /** The `name` attribute, or a generated positional label when the corpus omitted it. */
  readonly name: string;
  /** The `inputfile` attribute, or `null` for a case that evaluates against no document. */
  readonly inputFile: string | null;
  /** The FHIRPath expression text. */
  readonly expression: string;
  /**
   * The `<expression invalid="…">` attribute verbatim, or `null` when absent. Any value other than
   * `"false"` means the corpus expects the expression NOT to evaluate.
   */
  readonly invalid: string | null;
  /** The `predicate` attribute: the corpus wants the result coerced to a boolean. */
  readonly predicate: boolean;
  /** The `ordered` attribute, or `null` when absent. `false` means compare as a bag, not a list. */
  readonly ordered: boolean | null;
  /** The `<output>` elements in order. Empty means the corpus expects an empty collection. */
  readonly outputs: readonly ExpectedOutput[];
}

/** The outcome of running one case. */
export interface CaseResult {
  readonly testCase: SuiteCase;
  readonly bucket: Bucket;
  /** A value-free explanation, carried so a `wrong` case can be named in the failure message. */
  readonly detail: string;
}

/** The counts the suite reports. */
export interface CoverageCounts {
  readonly total: number;
  readonly evaluated: number;
  readonly unsupported: number;
  readonly wrong: number;
  readonly invalid: number;
}

// ---------------------------------------------------------------------------
// Reading the corpus
// ---------------------------------------------------------------------------

/** Read one vendored corpus file as text. */
export function readCorpusFile(name: string): string {
  return readFileSync(new URL(`./__fixtures__/fhirpath-suite/${name}`, import.meta.url), "utf8");
}

/** The value of `name` on `element`, or `null`. */
function attr(element: XmlElement, name: string): string | null {
  for (const a of element.attributes) {
    if (a.name === name) return a.value;
  }
  return null;
}

/** The concatenated character data under `element` (the corpus never nests markup inside these). */
function textOf(element: XmlElement): string {
  let out = "";
  const visit = (node: XmlNode): void => {
    if (node.type === "text") {
      out += node.value;
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const child of element.children) visit(child);
  return out;
}

/** The direct element children of `element` named `name`. */
function childElements(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((n): n is XmlElement => n.type === "element" && n.name === name);
}

/** Parse an XSD `boolean` attribute, or `null` when the attribute is absent. */
function boolAttr(element: XmlElement, name: string): boolean | null {
  const raw = attr(element, name);
  if (raw === null) return null;
  return raw === "true" || raw === "1";
}

/**
 * Read every live `<test>` element out of the vendored suite file.
 *
 * @returns The cases in document order.
 * @throws FhirXmlError when the suite file is not readable as XML (the reader refuses a DTD and any
 *   undefined entity; the vendored file carries neither).
 */
export function readSuiteCases(): SuiteCase[] {
  const root = readRawXml(readCorpusFile(SUITE_FILE));
  const cases: SuiteCase[] = [];
  for (const group of childElements(root, "group")) {
    const groupName = attr(group, "name") ?? "(unnamed group)";
    for (const [index, test] of childElements(group, "test").entries()) {
      const expressionElement = childElements(test, "expression")[0];
      if (expressionElement === undefined) {
        throw new Error(
          `fhirpath suite: <test> #${String(index + 1)} in group '${groupName}' has no <expression>`,
        );
      }
      cases.push({
        index: cases.length,
        group: groupName,
        name: attr(test, "name") ?? `${groupName}#${String(index + 1)}`,
        inputFile: attr(test, "inputfile"),
        expression: textOf(expressionElement),
        invalid: attr(expressionElement, "invalid"),
        predicate: boolAttr(test, "predicate") === true,
        ordered: boolAttr(test, "ordered"),
        outputs: childElements(test, "output").map((o) => ({
          type: attr(o, "type"),
          text: textOf(o),
        })),
      });
    }
  }
  return cases;
}

/** Every distinct `inputfile` the corpus names, sorted. */
export function inputDocumentNames(cases: readonly SuiteCase[]): string[] {
  return [...new Set(cases.map((c) => c.inputFile).filter((n): n is string => n !== null))].sort();
}

/** What happened when the harness tried to load one input document. */
export type InputLoad =
  | { readonly kind: "loaded"; readonly resource: FhirComplex }
  | { readonly kind: "missing"; readonly reason: string }
  | { readonly kind: "refused"; readonly fatalCode: string; readonly reason: string };

/**
 * Load every input document the corpus names, once each, recording what happened to each.
 *
 * Nothing is skipped and nothing is swallowed here: {@link assertDeclaredRefusalsHold} turns any
 * outcome other than `loaded` into a named suite failure unless it is declared in
 * {@link READER_REFUSED_INPUTS}.
 *
 * @param names - The distinct `inputfile` values the corpus uses.
 * @returns A map from file name to its load outcome.
 */
export function loadInputDocuments(names: readonly string[]): Map<string, InputLoad> {
  const out = new Map<string, InputLoad>();
  for (const name of names) {
    let text: string;
    try {
      text = readCorpusFile(name);
    } catch (err) {
      out.set(name, {
        kind: "missing",
        reason: `named by the corpus but not vendored under test/__fixtures__/fhirpath-suite/ (${
          err instanceof Error ? err.name : "unknown error"
        })`,
      });
      continue;
    }
    try {
      const parsed = name.endsWith(".json") ? parseResource(text) : parseResourceXml(text);
      out.set(name, { kind: "loaded", resource: parsed.resource });
    } catch (err) {
      out.set(name, {
        kind: "refused",
        fatalCode: err instanceof FhirCodecError ? err.code : "(not a FhirCodecError)",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

/**
 * The C8 gate: every input document either loads, or is declared refused with the exact fatal code
 * the declaration records.
 *
 * @param loads - The outcome of {@link loadInputDocuments}.
 * @returns The problems, each naming the document. Empty means the gate passes.
 */
export function declaredRefusalProblems(loads: ReadonlyMap<string, InputLoad>): string[] {
  const problems: string[] = [];
  for (const [name, load] of loads) {
    const declared = READER_REFUSED_INPUTS.get(name);
    if (load.kind === "missing") {
      problems.push(`${name}: ${load.reason}`);
      continue;
    }
    if (load.kind === "refused") {
      if (declared === undefined) {
        problems.push(
          `${name}: the reader refused this input document (${load.fatalCode}) and it is not ` +
            `declared in READER_REFUSED_INPUTS: ${load.reason}`,
        );
      } else if (declared !== load.fatalCode) {
        problems.push(
          `${name}: declared refused under ${declared}, actually refused under ${load.fatalCode}`,
        );
      }
      continue;
    }
    if (declared !== undefined) {
      problems.push(
        `${name}: declared refused under ${declared}, but the reader now parses it. Delete the ` +
          `READER_REFUSED_INPUTS line and let the cases that name it be scored.`,
      );
    }
  }
  for (const name of READER_REFUSED_INPUTS.keys()) {
    if (!loads.has(name)) {
      problems.push(`${name}: declared in READER_REFUSED_INPUTS but no case names it`);
    }
  }
  return problems;
}

/**
 * Render a result collection as the text {@link LENIENT_POLYMORPHIC_CASES} pins.
 *
 * Item by item, in order, using the same lexical reading the output comparison uses, so a declared
 * answer is the engine's answer and not a summary of it. An item with no lexical form renders as
 * `(uncomparable)`, which no declaration may state: a declared case has to be one the engine really
 * answers.
 */
export function renderResult(result: FpColl): string {
  return result.map((item) => lexicalOf(item) ?? "(uncomparable)").join("|");
}

/**
 * The gate over {@link LENIENT_POLYMORPHIC_CASES}: every declaration still describes a live case,
 * and every declared case still behaves exactly as declared.
 *
 * Both directions, so the description cannot quietly outlive what it describes. A declared name that
 * no longer names a case, a case that stops carrying the `invalid` attribute, an expression that was
 * edited upstream, an engine that starts refusing the construct or answering it differently: each
 * one fails the run and asks for the line to be deleted or re-made deliberately. The last of those
 * is the direction that closes the gap, so it must be impossible to miss.
 *
 * @param cases - Every case the corpus carries.
 * @param loads - The outcome of {@link loadInputDocuments}.
 * @returns The problems, each naming the case. Empty means the gate passes.
 */
export function declaredLenientPolymorphicProblems(
  cases: readonly SuiteCase[],
  loads: ReadonlyMap<string, InputLoad>,
): string[] {
  const problems: string[] = [];
  for (const [name, declared] of LENIENT_POLYMORPHIC_CASES) {
    const matching = cases.filter((c) => c.name === name);
    if (matching.length !== 1) {
      problems.push(
        `${name}: declared in LENIENT_POLYMORPHIC_CASES but the corpus carries ` +
          `${String(matching.length)} case(s) by that name`,
      );
      continue;
    }
    const testCase = matching[0] as SuiteCase;
    if (testCase.expression !== declared.expression) {
      problems.push(
        `${name}: declared for expression '${declared.expression}', the corpus now spells it ` +
          `'${testCase.expression}'`,
      );
      continue;
    }
    if (testCase.invalid === null || testCase.invalid === "false") {
      problems.push(
        `${name}: declared as invalid-under-strict-semantics, but the corpus no longer marks it ` +
          `invalid at all. Delete the LENIENT_POLYMORPHIC_CASES line: the case is scored on its ` +
          `output like any other.`,
      );
      continue;
    }
    const load = testCase.inputFile === null ? undefined : loads.get(testCase.inputFile);
    const document = load?.kind === "loaded" ? load.resource : null;
    const outcome = runExpression(testCase.expression, document);
    if (outcome.kind !== "value" || outcome.result.length === 0) {
      problems.push(
        `${name}: declared because this engine answers it, but it now ${
          outcome.kind === "value" ? "returns an empty collection" : `does not (${outcome.kind})`
        }. That closes the gap: delete the LENIENT_POLYMORPHIC_CASES line, the case now lands in ` +
          `the invalid bucket on its own.`,
      );
      continue;
    }
    const rendered = renderResult(outcome.result);
    if (rendered !== declared.answer) {
      problems.push(
        `${name}: declared answer '${declared.answer}', the engine now answers '${rendered}'`,
      );
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Comparing a result against a case's expected output
// ---------------------------------------------------------------------------

/**
 * The System type of one result item as this engine can determine it, or `null` when it cannot.
 *
 * A model node that is a complex element or a list has no scalar reading, and a value-absent
 * primitive has no value to read, so each is `null`: the harness cannot compare it, which is a
 * `wrong` answer and never a silent pass.
 */
function scalarKindOf(item: FpItem): "boolean" | "string" | "number" | null {
  if (item.t === "bool") return "boolean";
  if (item.t === "str") return "string";
  if (item.t === "num") return "number";
  if (!isPrimitive(item.node)) return null;
  const value = item.node.value;
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  if (value instanceof FhirDecimal) return "number";
  return null;
}

/** The lexical form of a result item, or `null` when it has none. */
function lexicalOf(item: FpItem): string | null {
  if (item.t === "bool") return item.value ? "true" : "false";
  if (item.t === "str") return item.value;
  if (item.t === "num") return String(item.value);
  if (!isPrimitive(item.node)) return null;
  const value = item.node.value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  if (value instanceof FhirDecimal) return value.toString();
  return null;
}

/** The numeric reading of a result item, or `null` when it has none. */
function numericOf(item: FpItem): number | null {
  if (item.t === "num") return item.value;
  if (item.t === "node" && isPrimitive(item.node) && item.node.value instanceof FhirDecimal) {
    return Number(item.node.value.toString());
  }
  return null;
}

/**
 * Output types the corpus spells as a **FHIRPath temporal literal**, `@`-prefixed.
 *
 * This package's model has no temporal type: a `date` / `dateTime` / `time` primitive is carried as
 * its FHIR lexical string (`1974-12-25`), which is the literal's text with the `@` sigil removed.
 * Comparing the two after removing the sigil compares the same lexical value; comparing them
 * verbatim would score the engine wrong for a difference in notation rather than in content, and
 * neither permitted remedy could fix that (the engine cannot refuse a string for being date-shaped,
 * and it has no date type to return instead).
 */
const TEMPORAL_TYPES: ReadonlySet<string> = new Set(["date", "dateTime", "time"]);

/** Output types whose content is a plain string in this package's model. */
const STRING_TYPES: ReadonlySet<string> = new Set(["string", "code", "id"]);

/** Output types whose content is numeric. */
const NUMERIC_TYPES: ReadonlySet<string> = new Set(["integer", "decimal"]);

/** Whether one result item matches one expected output. A `null` type means "a literal's text". */
function itemMatches(item: FpItem, expected: ExpectedOutput): boolean {
  const type = expected.type;
  const text = expected.text;
  if (type === "boolean") {
    return scalarKindOf(item) === "boolean" && lexicalOf(item) === text;
  }
  if (type !== null && NUMERIC_TYPES.has(type)) {
    const actual = numericOf(item);
    const wanted = Number(text);
    if (actual === null || !Number.isFinite(wanted)) return false;
    if (type === "integer" && !Number.isInteger(actual)) return false;
    return actual === wanted;
  }
  if (type !== null && STRING_TYPES.has(type)) {
    return scalarKindOf(item) === "string" && lexicalOf(item) === text;
  }
  if (type !== null && TEMPORAL_TYPES.has(type)) {
    const wanted = text.startsWith("@") ? text.slice(1) : text;
    return scalarKindOf(item) === "string" && lexicalOf(item) === wanted;
  }
  if (type !== null) {
    // `Quantity`, and any type a later corpus tag adds. This engine yields no item carrying a unit
    // beside a magnitude, so there is nothing to compare and the case is wrong, never a silent pass.
    return false;
  }
  // No declared type: the schema says the content is the string form of a literal.
  return lexicalOf(item) === text;
}

/**
 * Compare a result collection against a case's expected outputs.
 *
 * @returns `null` when they match, or a value-free reason string when they do not.
 */
function compareOutputs(testCase: SuiteCase, result: FpColl): string | null {
  if (testCase.predicate) {
    // The corpus asks for the result coerced to a boolean, so the shape of the collection is not
    // what is under test; `convertToBoolean` is the engine's own coercion.
    const wanted = testCase.outputs[0];
    if (testCase.outputs.length !== 1 || wanted === undefined || wanted.type !== "boolean") {
      return "a predicate case does not carry exactly one boolean output";
    }
    const actual = convertToBoolean(result) ? "true" : "false";
    return actual === wanted.text ? null : `predicate expected ${wanted.text}, got ${actual}`;
  }
  if (result.length !== testCase.outputs.length) {
    return `expected ${String(testCase.outputs.length)} item(s), got ${String(result.length)}`;
  }
  if (testCase.ordered === false) {
    // Collection equality rather than list equality: every expected output must be matched by a
    // distinct result item, in any order.
    const taken = new Array<boolean>(result.length).fill(false);
    for (const expected of testCase.outputs) {
      const at = result.findIndex((item, i) => taken[i] !== true && itemMatches(item, expected));
      if (at < 0) return `no result item matches an expected ${expected.type ?? "literal"} output`;
      taken[at] = true;
    }
    return null;
  }
  for (const [i, expected] of testCase.outputs.entries()) {
    const item = result[i];
    if (item === undefined || !itemMatches(item, expected)) {
      return `result item ${String(i + 1)} does not match the expected ${
        expected.type ?? "literal"
      } output`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Running the corpus
// ---------------------------------------------------------------------------

/** The stand-in `%resource` for a case with no `inputfile`: no document, so no properties. */
const NO_DOCUMENT: FhirComplex = { kind: "complex", properties: [] };

/** What the engine did with one expression, before any comparison. */
type EngineOutcome =
  | { readonly kind: "value"; readonly result: FpColl }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "threw"; readonly message: string };

/**
 * Run one expression through the engine, separating a **refusal** from every other failure.
 *
 * `evaluateInvariant` deliberately collapses the two (its fail-safe catch-all is what makes an
 * unevaluable invariant `INVARIANT_UNCHECKED`), so this harness calls the parser and evaluator
 * directly: a case may only be counted unsupported when the engine raised
 * {@link UnsupportedFhirPathError} itself.
 */
function runExpression(expression: string, document: FhirComplex | null): EngineOutcome {
  try {
    const ast = parseFhirPath(expression);
    const focus = document === null ? [] : focusCollection(document);
    const result = evaluate(ast, focus, { resource: document ?? NO_DOCUMENT, context: focus });
    return { kind: "value", result };
  } catch (err) {
    if (err instanceof UnsupportedFhirPathError) return { kind: "refused", message: err.message };
    return { kind: "threw", message: err instanceof Error ? err.name : "non-Error throw" };
  }
}

/**
 * Classify one case into exactly one bucket.
 *
 * @param testCase - The case, as the corpus wrote it.
 * @param loads - The load outcome of every input document the corpus names.
 * @returns The bucket plus a value-free detail string.
 */
export function classifyCase(
  testCase: SuiteCase,
  loads: ReadonlyMap<string, InputLoad>,
): CaseResult {
  let document: FhirComplex | null = null;
  let documentRefused = false;
  if (testCase.inputFile !== null) {
    const load = loads.get(testCase.inputFile);
    if (load === undefined) {
      throw new Error(
        `fhirpath suite: case '${testCase.name}' names input document '${testCase.inputFile}', ` +
          `which was never loaded`,
      );
    }
    if (load.kind === "loaded") document = load.resource;
    else documentRefused = true;
  }
  const outcome = runExpression(testCase.expression, document);

  if (documentRefused) {
    // The document is a declared reader refusal (the gate fails the run otherwise), so no answer the
    // engine produces can be checked against the corpus. The case is asked anyway, with no focus,
    // and counted declined on the exact refusal REFUSED_INPUT_CASES pins: a placement that can only
    // understate the engine's coverage, never flatter it. Read that docblock before touching this.
    // Anything other than the pinned refusal is uncomparable, hence wrong.
    if (outcome.kind === "refused" && REFUSED_INPUT_CASES.get(testCase.name) === outcome.message) {
      return {
        testCase,
        bucket: "unsupported",
        detail:
          `the input document is unreadable, so the case was asked with no focus and the engine ` +
          `refused it (${outcome.message})`,
      };
    }
    return {
      testCase,
      bucket: "wrong",
      detail:
        `the reader refuses input document '${String(testCase.inputFile)}', and the engine did ` +
        `not answer with the declared document-independent refusal, so the case cannot be scored`,
    };
  }

  // The corpus says this expression is not meant to evaluate. Refusing it, or producing nothing, is
  // the honest outcome; manufacturing a non-empty answer is not, and there is no exception to that:
  // a case whose non-empty answer is explainable (see LENIENT_POLYMORPHIC_CASES) is still a case the
  // engine answered where the corpus says there is no answer, so it is counted `wrong` and reddens
  // the suite. Declaring such a case out of this bucket would make the headline `wrong` count a
  // statement about which disagreements were excused rather than about the engine.
  if (testCase.invalid !== null && testCase.invalid !== "false") {
    if (outcome.kind === "value" && outcome.result.length > 0) {
      const declared = LENIENT_POLYMORPHIC_CASES.get(testCase.name);
      const why =
        declared !== undefined && declared.expression === testCase.expression
          ? `; the corpus marks it invalid under strict polymorphic semantics only, and this engine ` +
            `is lenient there (see LENIENT_POLYMORPHIC_CASES), which explains the disagreement ` +
            `without making it any less of one`
          : "";
      return {
        testCase,
        bucket: "wrong",
        detail:
          `the corpus marks this expression invalid='${testCase.invalid}', but the engine ` +
          `returned ${String(outcome.result.length)} item(s)${why}`,
      };
    }
    return { testCase, bucket: "invalid", detail: `invalid='${testCase.invalid}'` };
  }

  if (outcome.kind === "refused") {
    return { testCase, bucket: "unsupported", detail: `the engine refused: ${outcome.message}` };
  }
  if (outcome.kind === "threw") {
    return {
      testCase,
      bucket: "wrong",
      detail: `the engine threw ${outcome.message}, which is not a refusal`,
    };
  }
  const mismatch = compareOutputs(testCase, outcome.result);
  if (mismatch === null) return { testCase, bucket: "evaluated", detail: "matched" };
  return { testCase, bucket: "wrong", detail: mismatch };
}

/** Everything one run produced, so the assertions can grade it without running it again. */
export interface SuiteRun {
  readonly cases: readonly SuiteCase[];
  readonly loads: ReadonlyMap<string, InputLoad>;
  readonly results: readonly CaseResult[];
  readonly counts: CoverageCounts;
}

/** Run the whole corpus. */
export function runSuite(): SuiteRun {
  const cases = readSuiteCases();
  const loads = loadInputDocuments(inputDocumentNames(cases));
  const results = cases.map((c) => classifyCase(c, loads));
  return { cases, loads, results, counts: countBuckets(results) };
}

/** Tally the buckets. */
export function countBuckets(results: readonly CaseResult[]): CoverageCounts {
  const of = (bucket: Bucket): number => results.filter((r) => r.bucket === bucket).length;
  return {
    total: results.length,
    evaluated: of("evaluated"),
    unsupported: of("unsupported"),
    wrong: of("wrong"),
    invalid: of("invalid"),
  };
}

/**
 * The fraction of the whole corpus the engine answers, as a percentage to one decimal place.
 *
 * The denominator is every live case, the cases the corpus marks invalid included: a caller asking
 * "what fraction of this suite does the library answer" is asking about the suite it was handed, not
 * about a subset chosen after the fact.
 */
export function answeredFraction(counts: CoverageCounts): string {
  return `${((counts.evaluated / counts.total) * 100).toFixed(1)}%`;
}

/**
 * The same fraction over the cases the corpus expects to evaluate at all, i.e. with the `invalid`
 * bucket removed from the denominator. Reported beside {@link answeredFraction} because the two
 * answer different questions and quoting one as the other is how a coverage number drifts.
 */
export function answeredFractionOfValid(counts: CoverageCounts): string {
  const denominator = counts.total - counts.invalid;
  return `${((counts.evaluated / denominator) * 100).toFixed(1)}%`;
}
