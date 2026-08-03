#!/usr/bin/env tsx
/**
 * Base-vs-head read differential for the XML and JSON codecs.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS AT ALL
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * Three consecutive reader changes measured themselves with a harness that was never committed, so
 * the headline numbers in their changelogs could not be re-derived by a reviewer. This is that
 * harness, committed. Run it, get the numbers, disagree with them.
 *
 *     pnpm differential:read                    # against origin/main
 *     pnpm differential:read --base <ref>       # against any ref
 *     pnpm differential:read --json             # machine-readable
 *
 * It materializes `src/` from `--base` into a temp directory, imports that tree and the working
 * tree **into one process**, and runs a generated corpus through both. Nothing is built; both sides
 * are the TypeScript sources as they stand.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE BAR IT MEASURES AGAINST: NO SUPPRESSION
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * A reader change is allowed to read MORE and report MORE. It is not allowed to quietly read less.
 * So the report is organized around what could have been lost:
 *
 *   - a leaf value base read that head does not, counted as a MULTISET so a dropped repeat is
 *     visible, and containment-checked: a value that moved INSIDE an opaque narrative string is
 *     still present, and is counted as present only by finding it there;
 *   - a read diagnostic or validation finding that disappeared, split by whether its location
 *     RESOLVES -- a diagnostic base could only report at `<withheld>` is a weaker loss than one it
 *     could name;
 *   - a `valid: false -> true` or `safeToSummarize: false -> true` flip;
 *   - a retraction or negation the safety spine no longer sees;
 *   - a document that newly throws;
 *   - an output that got SHORTER.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * AND THE COMPARAND, WHICH IS THE PART THAT IS EASY TO GET WRONG
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * "Base vs head" is not always the question. When a change makes the reader recognise a document it
 * previously misread, findings raised FROM the misreading disappear, and measured against the
 * previous release that looks like suppression. The yardstick that settles it is **the same document
 * spelled the other way** -- a spelling the reader already recognised -- because that twin's reading
 * is what the newly-recognised one should equal. Every shape that has such a twin declares it, and
 * the twin section compares head's reading of the shape against BASE's reading of that twin.
 *
 * Both comparands are printed. Read both. A number from one of them alone will mislead you.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * SELF-CHECKS (a harness that lies is worse than no harness)
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * A previous run of an uncommitted ancestor of this file published a tally that sat after a
 * `continue`, so it counted only the documents whose reading had MOVED: 434 where the truth was 836.
 * Every tally here is therefore accumulated in one pass over every document with no early exit, and
 * `reconcile()` cross-checks the ones that have an independently derivable total. It also runs a
 * **negative control**: it asserts the base tree it loaded actually behaves like base and not like
 * head, so a stale or mis-resolved checkout fails loudly instead of reporting a comfortable zero.
 *
 * @packageDocumentation
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(REPO, "test", "__fixtures__");

/** The slice of the package surface this differential exercises. Both trees expose it identically. */
interface Codec {
  parseResourceXml: (src: string) => { resource: unknown; issues: readonly RawIssue[] };
  parseResource: (src: string) => { resource: unknown; issues: readonly RawIssue[] };
  serializeResource: (resource: never) => string;
  serializeResourceXml: (resource: never) => string;
  validateResource: (resource: never) => { valid: boolean; issues: readonly RawIssue[] };
  readSafety: (resource: never) => RawSafety;
}

interface RawIssue {
  readonly code: string;
  readonly severity?: string;
  readonly expression?: string;
}

interface RawSafety {
  readonly retracted: boolean;
  readonly safeToSummarize: boolean;
  readonly negations: readonly string[];
  readonly shadowedProperties: readonly string[];
  readonly arrayWrappedScalars: readonly string[];
  readonly nestedArrays: readonly string[];
}

/** Everything one tree makes of one document. `thrown` is a reading too, and a comparable one. */
interface Reading {
  readonly thrown: string | undefined;
  readonly issues: readonly string[];
  readonly valid: boolean;
  readonly findings: readonly string[];
  readonly retracted: boolean;
  readonly safeToSummarize: boolean;
  readonly negations: readonly string[];
  readonly json: string;
  readonly xml: string;
  readonly leaves: readonly string[];
  /**
   * What happens when the tree is asked to read back what it just emitted.
   *
   * `"stable"` (re-reads, and a second round trip is a fixed point), `"unstable"` (re-reads to
   * something else), or `"unreadable"` (throws). **This is not decoration.** The last real defect
   * found in this reader by a gate was a namespace fixup that emitted output which was not
   * well-formed and threw on re-read, reopening the very defect its slice claimed to close, and a
   * differential that only ever parses its INPUT cannot see that.
   *
   * `"refused"` is the fourth state and a deliberate non-event: the writer declined to emit the
   * document at all, so there is nothing to read back. It is NOT a regression and must never be
   * counted as one, which is why it is its own value rather than folded into `"unreadable"`.
   */
  readonly reread: "stable" | "unstable" | "unreadable" | "refused";
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Loading the two trees
// ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Materialize `src/` at `ref` into a temp directory and import it. `git archive` is used rather than
 * a worktree so the checkout cannot pick up an untracked file from the working tree, which is the
 * failure mode that would make base look like head.
 */
async function loadBase(ref: string): Promise<{ codec: Codec; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "fhir-differential-"));
  const archive = execFileSync("git", ["archive", ref, "src"], {
    cwd: REPO,
    maxBuffer: 256 * 1024 * 1024,
    encoding: "buffer",
  });
  execFileSync("tar", ["-x", "-C", dir], { input: archive });
  const codec = (await import(pathToFileURL(join(dir, "src", "index.ts")).href)) as Codec;
  return { codec, dir };
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// The corpus
// ──────────────────────────────────────────────────────────────────────────────────────────────

const XHTML = "http://www.w3.org/1999/xhtml";

/**
 * The fragments inserted at every element position of every XML fixture.
 *
 * Each carries a distinct sentinel so a value can be traced from the input to the reading, and each
 * `narrative` fragment is paired with the `twin` spelling the reader ALREADY handled before this
 * change, which is what makes the twin comparand computable rather than asserted.
 */
interface Shape {
  readonly id: string;
  /** The fragment, with `@` standing for the sentinel the generator substitutes. */
  readonly xml: string;
  /** Namespace declarations the fragment needs on the ROOT element. */
  readonly rootAttrs?: string;
  /** Whether this fragment puts prose into a narrative slot at all. */
  readonly narrative: boolean;
  /** The same document spelled a way the reader already recognised, when there is one. */
  readonly twin?: string;
}

const SHAPES: readonly Shape[] = [
  // ── The item's cursor: prose written BESIDE a capitalized child, every spelling. ──────────────
  {
    id: "beside-caps-default",
    xml: `<div xmlns="${XHTML}">@<BR/></div>`,
    narrative: true,
    twin: `<div xmlns="${XHTML}">@<br/></div>`,
  },
  {
    id: "beside-caps-prefixed",
    xml: "<h:div>@<h:BR/></h:div>",
    rootAttrs: ` xmlns:h="${XHTML}"`,
    narrative: true,
    twin: `<div xmlns="${XHTML}">@<br/></div>`,
  },
  {
    id: "beside-caps-nodecl",
    xml: "<div>@<BR/></div>",
    narrative: true,
    twin: "<div>@<br/></div>",
  },
  {
    id: "beside-caps-multi",
    xml: `<div xmlns="${XHTML}">@<P>dose</P> then <BR/></div>`,
    narrative: true,
    twin: `<div xmlns="${XHTML}">@<p>dose</p> then <br/></div>`,
  },
  // ── The same loss with the prose held INSIDE the capitalized child. ──────────────────────────
  {
    id: "inside-caps-default",
    xml: `<div xmlns="${XHTML}"><Table>@</Table></div>`,
    narrative: true,
    twin: `<div xmlns="${XHTML}"><table>@</table></div>`,
  },
  {
    id: "inside-caps-prefixed",
    xml: "<h:div><h:Table>@</h:Table></h:div>",
    rootAttrs: ` xmlns:h="${XHTML}"`,
    narrative: true,
    twin: `<div xmlns="${XHTML}"><table>@</table></div>`,
  },
  // ── The shape that costs something: a FHIR-looking element inside a mis-modeled narrative. ───
  {
    id: "caps-modifier-extension",
    xml: `<div xmlns="${XHTML}"><Table><modifierExtension url="urn:x"/>@</Table></div>`,
    narrative: true,
    twin: `<div xmlns="${XHTML}"><table><modifierExtension url="urn:x"/>@</table></div>`,
  },
  {
    id: "caps-status-retraction",
    xml: `<div xmlns="${XHTML}"><Observation><status value="entered-in-error"/>@</Observation></div>`,
    narrative: true,
    twin: `<div xmlns="${XHTML}"><observation><status value="entered-in-error"/>@</observation></div>`,
  },
  {
    id: "caps-resource-shaped",
    xml: `<div xmlns="${XHTML}"><Patient><id value="p"/>@</Patient></div>`,
    narrative: true,
    twin: `<div xmlns="${XHTML}"><patient><id value="p"/>@</patient></div>`,
  },
  // ── Narratives with no capitalized child: these must be byte-identical on both sides. ────────
  { id: "plain-default", xml: `<div xmlns="${XHTML}"><p>@</p></div>`, narrative: true },
  { id: "plain-text-only", xml: `<div xmlns="${XHTML}">@</div>`, narrative: true },
  {
    id: "plain-prefixed",
    xml: "<h:div><h:p>@</h:p></h:div>",
    rootAttrs: ` xmlns:h="${XHTML}"`,
    narrative: true,
  },
  { id: "plain-nodecl", xml: "<div><p>@</p></div>", narrative: true },
  {
    id: "prefixed-modifier-extension",
    xml: '<h:div><h:p><h:modifierExtension url="urn:x"/>@</h:p></h:div>',
    rootAttrs: ` xmlns:h="${XHTML}"`,
    narrative: true,
  },
  // ── A `div` outside XHTML: the documented residual, which must not move. ─────────────────────
  {
    id: "vendor-div-unprefixed",
    xml: '<div xmlns="urn:vendor"><Table>@</Table></div>',
    narrative: true,
  },
  {
    id: "vendor-div-prefixed",
    xml: "<v:div><v:Table>@</v:Table></v:div>",
    rootAttrs: ' xmlns:v="urn:vendor"',
    narrative: false,
  },
  // ── Attribute escaping in the carried fragment: the door a previous pass reopened. ───────────
  {
    id: "escape-lt-in-uri",
    xml: `<div xmlns="${XHTML}"><V:x/>@</div>`,
    rootAttrs: ' xmlns:V="urn:a&lt;b"',
    narrative: true,
  },
  {
    id: "escape-amp-quote",
    xml: `<div xmlns="${XHTML}" title="a&amp;b&quot;c"><BR/>@</div>`,
    narrative: true,
  },
  {
    id: "div-with-value-attr",
    xml: `<div xmlns="${XHTML}" value="v">@<BR/></div>`,
    narrative: true,
  },
  // ── The resource-valued unwrap itself, which the change also touches. ────────────────────────
  {
    id: "contained-stray-text",
    xml: '<contained>@<Observation><status value="final"/></Observation></contained>',
    narrative: false,
  },
  {
    id: "contained-stray-text-retracted",
    xml: '<contained>@<Observation><status value="entered-in-error"/></Observation></contained>',
    narrative: false,
  },
  {
    id: "contained-clean",
    xml: '<contained><Observation><status value="final"/>@</Observation></contained>',
    narrative: false,
  },
  {
    id: "contained-stray-text-both-sides",
    xml: '<contained>@<Observation>inner<status value="final"/></Observation></contained>',
    narrative: false,
  },
  {
    id: "contained-foreign-default-stray-text",
    xml: '<contained xmlns="urn:vendor">@<AllergyIntolerance><id value="a"/></AllergyIntolerance></contained>',
    narrative: false,
  },
  // A primitive whose value is written as element text rather than `value=`. The value has no slot
  // on the model and is dropped on BOTH trees; it is in the corpus so that stays measured.
  { id: "primitive-text-not-value", xml: "<status>@</status>", narrative: false },
  {
    id: "uppercase-div-wrapper",
    xml: `<DIV xmlns="${XHTML}">@<BR/></DIV>`,
    narrative: true,
  },
  {
    id: "entry-resource-stray-text",
    xml: '<entry><resource>@<Patient><id value="p"/></Patient></resource></entry>',
    narrative: false,
  },
];

/** Every element position in an XML document, as a byte offset just before its closing tag. */
function elementInsertionPoints(xml: string): number[] {
  const points: number[] = [];
  const stack: number[] = [];
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(xml)) !== null) {
    const [full, closing, , , selfClosing] = m;
    if (selfClosing === "/") continue;
    if (closing === "/") {
      stack.pop();
      points.push(m.index);
    } else {
      stack.push(m.index + full.length);
    }
  }
  return points.sort((a, b) => a - b);
}

/** Put `attrs` on the document's root element. */
function withRootAttrs(xml: string, attrs: string): string {
  const close = xml.indexOf(">");
  if (close === -1) return xml;
  const selfClosing = xml[close - 1] === "/";
  const at = selfClosing ? close - 1 : close;
  return xml.slice(0, at) + attrs + xml.slice(at);
}

interface Document {
  readonly name: string;
  readonly xml: string;
  readonly sentinel: string | undefined;
  readonly shape: string | undefined;
  /** The same document with the shape's twin spelling, when the shape has one. */
  readonly twinXml: string | undefined;
  readonly carriesNarrativeShape: boolean;
}

function buildCorpus(): Document[] {
  const docs: Document[] = [];
  const xmlFixtures = readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".xml"))
    .sort();
  for (const file of xmlFixtures) {
    const base = readFileSync(join(FIXTURES, file), "utf8").trim();
    docs.push({
      name: file,
      xml: base,
      sentinel: undefined,
      shape: undefined,
      twinXml: undefined,
      carriesNarrativeShape: false,
    });
    const points = elementInsertionPoints(base);
    for (const [pi, point] of points.entries()) {
      for (const shape of SHAPES) {
        const sentinel = `SENTINEL-${file}-${String(pi)}-${shape.id}`;
        const insert = (fragment: string): string => {
          const body =
            base.slice(0, point) + fragment.replaceAll("@", sentinel) + base.slice(point);
          return shape.rootAttrs === undefined ? body : withRootAttrs(body, shape.rootAttrs);
        };
        docs.push({
          name: `${file}#${String(pi)}:${shape.id}`,
          xml: insert(shape.xml),
          sentinel,
          shape: shape.id,
          twinXml: shape.twin === undefined ? undefined : insert(shape.twin),
          carriesNarrativeShape: shape.narrative,
        });
      }
    }
  }
  return docs;
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Reading a document with one tree
// ──────────────────────────────────────────────────────────────────────────────────────────────

/** Every primitive leaf value in a serialized model, as the JSON writer rendered them. */
function leavesOf(json: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") Object.values(v).forEach(walk);
    // `JSON.parse` yields nothing else that carries a value: a number, a boolean or `null`.
    else if (typeof v === "number" || typeof v === "boolean") out.push(String(v));
  };
  try {
    walk(JSON.parse(json));
  } catch {
    /* an unreadable serialization is reported by the `json` field itself */
  }
  return out;
}

const EMPTY_READING: Omit<Reading, "thrown"> = {
  issues: [],
  valid: false,
  findings: [],
  retracted: false,
  safeToSummarize: false,
  negations: [],
  json: "",
  xml: "",
  leaves: [],
  reread: "stable",
};

/**
 * Read back what a tree emitted. A conservative writer's output must re-read to the same model, and
 * a second round trip must change nothing; anything else means the emitted document is not the
 * document the reader just described.
 */
/**
 * The marker a refused serialization is recorded as.
 *
 * A writer that refuses a model has produced a real, comparable outcome, not an error the harness
 * should swallow. Recording it as a string keeps it inside every existing comparison (it is simply a
 * value neither tree's real output can collide with), while the tallies that would misread it as a
 * loss -- "output shorter", "no longer re-reads" -- exclude it explicitly.
 */
const REFUSED = "<refused>";

/**
 * Serialize, or record the refusal. Matched on the error NAME, not `instanceof`: base and head are
 * two separate module instances, so no constructor identity is shared between them.
 */
function emit(write: () => string): string {
  try {
    return write();
  } catch (error) {
    if (error instanceof Error && error.name === "FhirSerializeError") return REFUSED;
    throw error;
  }
}

function rereadOf(codec: Codec, emitted: string, json: string): Reading["reread"] {
  if (emitted === REFUSED || json === REFUSED) return "refused";
  try {
    const again = codec.parseResourceXml(emitted);
    if (codec.serializeResource(again.resource as never) !== json) return "unstable";
    return codec.serializeResourceXml(again.resource as never) === emitted ? "stable" : "unstable";
  } catch {
    return "unreadable";
  }
}

function read(codec: Codec, xml: string): Reading {
  try {
    const { resource, issues } = codec.parseResourceXml(xml);
    const v = codec.validateResource(resource as never);
    const s = codec.readSafety(resource as never);
    // Serialization is OUTSIDE the reading it describes: a writer that refuses must not take the
    // issues, findings and safety readout down with it, or every refusal reads as a total loss.
    const json = emit(() => codec.serializeResource(resource as never));
    const emitted = emit(() => codec.serializeResourceXml(resource as never));
    return {
      thrown: undefined,
      issues: issues.map((i) => `${i.code}@${i.expression ?? ""}`).sort(),
      valid: v.valid,
      findings: v.issues.map((i) => `${i.code}/${i.severity ?? ""}@${i.expression ?? ""}`).sort(),
      retracted: s.retracted,
      safeToSummarize: s.safeToSummarize,
      negations: [...s.negations].sort(),
      json,
      xml: emitted,
      leaves: leavesOf(json),
      reread: rereadOf(codec, emitted, json),
    };
  } catch (error) {
    return { ...EMPTY_READING, thrown: error instanceof Error ? error.name : "unknown" };
  }
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// The tallies
// ──────────────────────────────────────────────────────────────────────────────────────────────

/** Whether a diagnostic's location names a position, rather than being withheld or absent. */
function resolves(diagnostic: string): boolean {
  const at = diagnostic.indexOf("@");
  const expression = at === -1 ? "" : diagnostic.slice(at + 1);
  return expression !== "" && !expression.includes("<withheld>");
}

interface Tally {
  documents: number;
  moved: number;
  unmoved: number;
  newlyThrowing: number;
  noLongerThrowing: number;
  emittedUnreadable: number;
  emittedUnstable: number;
  emittedNewlyUnreadable: number;
  serializationRefused: number;
  validFalseToTrue: number;
  validTrueToFalse: number;
  safeFalseToTrue: number;
  retractionsLost: number;
  negationsLost: number;
  readDiagnosticsLost: number;
  readDiagnosticsLostResolvable: number;
  readDiagnosticsGained: number;
  validationFindingsLost: number;
  validationFindingsLostResolvable: number;
  validationFindingsGained: number;
  leavesBaseRead: number;
  leavesMissingAtHead: number;
  leavesRecoveredInsideNarrative: number;
  leavesNotComparedRefused: number;
  jsonShorter: number;
  xmlShorter: number;
  narrativeBearing: number;
  narrativePreservedBase: number;
  narrativePreservedHead: number;
  /** Every lost read diagnostic, counted by its issue code, so the total is attributable. */
  readonly readDiagnosticsLostByCode: Map<string, number>;
  readonly examples: string[];
}

function emptyTally(): Tally {
  return {
    documents: 0,
    moved: 0,
    unmoved: 0,
    newlyThrowing: 0,
    noLongerThrowing: 0,
    emittedUnreadable: 0,
    emittedUnstable: 0,
    emittedNewlyUnreadable: 0,
    serializationRefused: 0,
    validFalseToTrue: 0,
    validTrueToFalse: 0,
    safeFalseToTrue: 0,
    retractionsLost: 0,
    negationsLost: 0,
    readDiagnosticsLost: 0,
    readDiagnosticsLostResolvable: 0,
    readDiagnosticsGained: 0,
    validationFindingsLost: 0,
    validationFindingsLostResolvable: 0,
    validationFindingsGained: 0,
    leavesBaseRead: 0,
    leavesMissingAtHead: 0,
    leavesRecoveredInsideNarrative: 0,
    leavesNotComparedRefused: 0,
    jsonShorter: 0,
    xmlShorter: 0,
    narrativeBearing: 0,
    narrativePreservedBase: 0,
    narrativePreservedHead: 0,
    readDiagnosticsLostByCode: new Map(),
    examples: [],
  };
}

/**
 * Fold one document's two readings into the tally.
 *
 * **There is deliberately no early return in here.** The tally that got published wrong sat behind a
 * `continue` that skipped documents whose reading had not moved, so it measured a subset and called
 * it the whole. Everything is counted for every document; `moved` is just another field.
 */
function fold(tally: Tally, doc: Document, base: Reading, head: Reading): void {
  tally.documents += 1;
  const moved = JSON.stringify(base) !== JSON.stringify(head);
  if (moved) tally.moved += 1;
  else tally.unmoved += 1;

  if (base.thrown === undefined && head.thrown !== undefined) {
    tally.newlyThrowing += 1;
    tally.examples.push(`NEWLY THROWING ${doc.name}: ${head.thrown}`);
  }
  if (base.thrown !== undefined && head.thrown === undefined) tally.noLongerThrowing += 1;

  if (head.reread === "unreadable") tally.emittedUnreadable += 1;
  if (head.reread === "unstable") {
    tally.emittedUnstable += 1;
    tally.examples.push(
      `EMITTED XML RE-READS TO SOMETHING ELSE ${doc.name} (base: ${base.reread})`,
    );
  }
  // A refusal is not a regression: the writer declined to emit, which is the change under
  // measurement, so it is tallied on its own line rather than as output that stopped re-reading.
  if (head.reread === "refused") tally.serializationRefused += 1;
  if (base.reread === "stable" && head.reread !== "stable" && head.reread !== "refused") {
    tally.emittedNewlyUnreadable += 1;
    tally.examples.push(`EMITTED XML NO LONGER RE-READS ${doc.name}: ${head.reread}`);
  }

  if (!base.valid && head.valid) tally.validFalseToTrue += 1;
  if (base.valid && !head.valid) tally.validTrueToFalse += 1;
  if (!base.safeToSummarize && head.safeToSummarize) tally.safeFalseToTrue += 1;
  if (base.retracted && !head.retracted) {
    tally.retractionsLost += 1;
    tally.examples.push(`RETRACTION LOST ${doc.name}`);
  }
  const lostNegations = base.negations.filter((n) => !head.negations.includes(n));
  if (lostNegations.length > 0) {
    tally.negationsLost += lostNegations.length;
    tally.examples.push(`NEGATION LOST ${doc.name}: ${lostNegations.join(",")}`);
  }

  const headIssues = new Set(head.issues);
  const baseIssues = new Set(base.issues);
  for (const issue of base.issues) {
    if (headIssues.has(issue)) continue;
    tally.readDiagnosticsLost += 1;
    // `${code}@${expression}`, and only the expression can carry a further `@` (the `.@attr` form).
    const code = issue.slice(0, Math.max(issue.indexOf("@"), 0));
    tally.readDiagnosticsLostByCode.set(code, (tally.readDiagnosticsLostByCode.get(code) ?? 0) + 1);
    if (resolves(issue)) {
      tally.readDiagnosticsLostResolvable += 1;
      tally.examples.push(`READ DIAGNOSTIC LOST AT A RESOLVING LOCATION ${doc.name}: ${issue}`);
    }
  }
  tally.readDiagnosticsGained += head.issues.filter((i) => !baseIssues.has(i)).length;

  const headFindings = new Set(head.findings);
  const baseFindings = new Set(base.findings);
  for (const finding of base.findings) {
    if (headFindings.has(finding)) continue;
    tally.validationFindingsLost += 1;
    if (resolves(finding)) tally.validationFindingsLostResolvable += 1;
  }
  tally.validationFindingsGained += head.findings.filter((f) => !baseFindings.has(f)).length;

  // A leaf value is "still read" if head reads it as a leaf OR carries it inside a string it read
  // (which is what an opaque narrative does to everything under it). Containment is CHECKED, never
  // assumed: a value that is simply gone is counted as gone.
  //
  // COUNTED AS A MULTISET, NOT A SET. A set comparison cannot see a value base read three times and
  // head reads once, so it would call a real loss of two occurrences zero. Each base occurrence
  // consumes one head occurrence; when they run out, the leaf falls through to the containment
  // check and then to the loss tally.
  //
  // A REFUSED serialization is excluded, and this is a correctness fix, not a convenience. The leaf
  // comparison reads values out of the emitted JSON, so a document head declined to emit has no
  // leaves to find and every value base read would be counted lost. Head's MODEL still holds all of
  // them -- the refusal is about emitting, not about reading -- so scoring those documents here
  // would report the exact opposite of what happened. They are counted on their own line instead.
  if (head.reread === "refused") {
    tally.leavesNotComparedRefused += base.leaves.length;
  } else {
    const headRemaining = new Map<string, number>();
    for (const leaf of head.leaves) headRemaining.set(leaf, (headRemaining.get(leaf) ?? 0) + 1);
    tally.leavesBaseRead += base.leaves.length;
    for (const leaf of base.leaves) {
      const remaining = headRemaining.get(leaf) ?? 0;
      if (remaining > 0) {
        headRemaining.set(leaf, remaining - 1);
        continue;
      }
      // Containment is only accepted from a leaf that is itself a CARRIED XML FRAGMENT, so an
      // unrelated leaf that happens to contain the same substring cannot launder a real loss.
      if (head.leaves.some((h) => h.startsWith("<") && h.endsWith(">") && h.includes(leaf))) {
        tally.leavesRecoveredInsideNarrative += 1;
        continue;
      }
      tally.leavesMissingAtHead += 1;
      // The document, the length and the shape, never the value: every other line this harness
      // prints is a bounded expression, and a loss report is not the place to print content.
      tally.examples.push(
        `LEAF VALUE MISSING ${doc.name}: ${String(leaf.length)} chars, ${leaf.startsWith("<") ? "fragment" : "scalar"}`,
      );
    }
  }

  // A refused output is not a shorter output. Comparing the marker's length to a real document's
  // would report every refusal as lost content, which is precisely backwards.
  if (head.json !== REFUSED && head.json.length < base.json.length) tally.jsonShorter += 1;
  if (head.xml !== REFUSED && head.xml.length < base.xml.length) tally.xmlShorter += 1;

  if (doc.carriesNarrativeShape && doc.sentinel !== undefined) {
    tally.narrativeBearing += 1;
    if (base.json.includes(doc.sentinel)) tally.narrativePreservedBase += 1;
    if (head.json.includes(doc.sentinel)) tally.narrativePreservedHead += 1;
  }
}

/** Cross-check the tallies that have an independently derivable total. */
function reconcile(tally: Tally, corpus: readonly Document[]): string[] {
  const problems: string[] = [];
  // The corpus must have been generated from THIS package's fixtures. Several `@cosyte/*` parsers
  // are worked in parallel and a shared scratch directory has produced a green run measured against
  // a sibling package's files before now; a fixture only this package has is the cheapest guard.
  if (!corpus.some((d) => d.name.startsWith("patient-narrative.xml"))) {
    problems.push("the corpus holds no @cosyte/fhir XML fixture: it was built from the wrong tree");
  }
  if (tally.documents !== corpus.length) {
    problems.push(
      `counted ${String(tally.documents)} documents, corpus holds ${String(corpus.length)}`,
    );
  }
  if (tally.moved + tally.unmoved !== tally.documents) {
    problems.push(`moved + unmoved does not reconcile with the document count`);
  }
  const narrativeBearing = corpus.filter(
    (d) => d.carriesNarrativeShape && d.sentinel !== undefined,
  ).length;
  if (tally.narrativeBearing !== narrativeBearing) {
    problems.push(
      `narrative-bearing tally ${String(tally.narrativeBearing)} != ${String(narrativeBearing)} derived from the corpus`,
    );
  }
  if (tally.narrativePreservedHead > tally.narrativeBearing) {
    problems.push(`more narratives preserved than exist`);
  }
  return problems;
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The document whose reading THE SLICE BEING MEASURED moves, and one it does not.
 *
 * **This pair belongs to the change in the working tree, not to the harness, so a slice that changes
 * the reader updates it.** The first version of this control named the capitalized-child narrative of
 * the slice that committed this file. That slice then merged, `origin/main` began carrying it, and
 * the control fired on every subsequent run: a permanent false red on the harness's own alarm, which
 * is worse than no alarm, because the next reader learns to scroll past it. If you are reading this
 * because the control fired, check that first: it may be describing the previous slice, not yours.
 *
 * `moved` must be a document THIS change reads differently from base, and `unmoved` one it does not
 * touch. Neither may be a document the corpus is scored on, so the control cannot flatter the tally.
 */
const CONTROL = {
  /**
   * A primitive whose value is written as element text. Base reports the loss and then SERIALIZES
   * the document anyway (`<status/>` in XML, the member gone entirely in JSON); head refuses to
   * serialize it at all. That difference is this slice, so it is what the control keys on.
   */
  moved: `<Observation xmlns="http://hl7.org/fhir"><status>CONTROL</status></Observation>`,
  /** The same document spelled conformantly, which this change must leave exactly as it was. */
  unmoved: `<Observation xmlns="http://hl7.org/fhir"><status value="CONTROL"/></Observation>`,
} as const;

/**
 * The negative control. A differential is only worth reading if the two trees really are two trees,
 * and the cheapest way for this to silently report all-zero is for `--base` to resolve to something
 * that already carries the change. So: assert the two disagree on a document whose reading this
 * slice is known to move, and assert they AGREE on one it does not.
 *
 * The reading compared is the whole reading, not just the serialized JSON: this slice changes what
 * the safety layer and the validator SAY about a document without changing the model's values, and a
 * control that only compared `json` would have passed on base and reported a comfortable zero.
 */
function negativeControl(base: Codec, head: Codec): string[] {
  const problems: string[] = [];
  const whole = (r: Reading): string =>
    JSON.stringify({
      json: r.json,
      valid: r.valid,
      findings: r.findings,
      issues: r.issues,
      safeToSummarize: r.safeToSummarize,
      retracted: r.retracted,
      negations: r.negations,
    });
  if (whole(read(base, CONTROL.moved)) === whole(read(head, CONTROL.moved))) {
    problems.push(
      "the base tree reads the control document exactly as head does: either --base does not name a tree from before this change, or CONTROL.moved still describes an earlier slice, so every zero below is meaningless",
    );
  }
  if (whole(read(base, CONTROL.unmoved)) !== whole(read(head, CONTROL.unmoved))) {
    problems.push(
      "the two trees disagree on the conformant spelling, which this change must not touch",
    );
  }
  return problems;
}

function argOf(flag: string, fallback: string): string {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

async function main(): Promise<void> {
  const ref = argOf("--base", "origin/main");
  const asJson = process.argv.includes("--json");
  const { codec: base, dir } = await loadBase(ref);
  const head = (await import(pathToFileURL(join(REPO, "src", "index.ts")).href)) as Codec;

  try {
    const controlProblems = negativeControl(base, head);
    const corpus = buildCorpus();
    const tally = emptyTally();
    // Every headline number is also accumulated per shape, so a reviewer can attribute it rather
    // than take it. A total that no shape accounts for is a bug in the harness, not a finding.
    const byShape = new Map<string, Tally>();
    for (const doc of corpus) {
      const b = read(base, doc.xml);
      const h = read(head, doc.xml);
      fold(tally, doc, b, h);
      const key = doc.shape ?? "(unmutated fixture)";
      let shapeTally = byShape.get(key);
      if (shapeTally === undefined) {
        shapeTally = emptyTally();
        byShape.set(key, shapeTally);
      }
      fold(shapeTally, doc, b, h);
    }

    // The JSON codec is untouched by an XML reader change, and this is the check that says so.
    let jsonFixturesMoved = 0;
    const jsonFixtures = readdirSync(FIXTURES)
      .filter((f) => f.endsWith(".json"))
      .sort();
    const readJson = (codec: Codec, src: string): string => {
      // A fixture that throws is a reading too: `quirk-primitive-extension-misaligned.json` fails
      // closed on purpose, and "both sides throw the same fatal" is the parity that matters there.
      try {
        const { resource, issues } = codec.parseResource(src);
        return JSON.stringify({
          json: codec.serializeResource(resource as never),
          issues: issues.map((i) => `${i.code}@${i.expression ?? ""}`),
        });
      } catch (error) {
        return `threw:${error instanceof Error ? `${error.name}:${error.message}` : "unknown"}`;
      }
    };
    for (const file of jsonFixtures) {
      const src = readFileSync(join(FIXTURES, file), "utf8");
      if (readJson(base, src) !== readJson(head, src)) jsonFixturesMoved += 1;
    }

    // The twin comparand: head's reading of a spelling the reader now recognises, against BASE's
    // reading of the spelling it already recognised. This is the number that says whether anything
    // was actually lost, as opposed to a finding that only ever existed because of the misreading.
    let twins = 0;
    let twinsEqual = 0;
    let twinsHeadLouder = 0;
    let twinsHeadWeaker = 0;
    const twinExamples: string[] = [];
    const louderExamples: string[] = [];
    for (const doc of corpus) {
      if (doc.twinXml === undefined) continue;
      twins += 1;
      const headReading = read(head, doc.xml);
      const baseTwin = read(base, doc.twinXml);
      // The twin differs from the document by the tag bytes themselves, so compare everything the
      // reading says ABOUT the document rather than the document echoed back.
      const shrink = (r: Reading): string =>
        JSON.stringify({
          valid: r.valid,
          findings: r.findings,
          issues: r.issues,
          retracted: r.retracted,
          safeToSummarize: r.safeToSummarize,
          negations: r.negations,
          thrown: r.thrown,
        });
      if (shrink(headReading) === shrink(baseTwin)) {
        twinsEqual += 1;
      } else if (
        headReading.valid === baseTwin.valid &&
        headReading.safeToSummarize === baseTwin.safeToSummarize &&
        baseTwin.issues.every((i) => headReading.issues.includes(i)) &&
        baseTwin.findings.every((f) => headReading.findings.includes(f))
      ) {
        twinsHeadLouder += 1;
        if (louderExamples.length < 5) {
          const extra = headReading.issues.filter((i) => !baseTwin.issues.includes(i));
          louderExamples.push(`${doc.name}: +${extra.join(",")}`);
        }
      } else {
        twinsHeadWeaker += 1;
        if (twinExamples.length < 5) twinExamples.push(doc.name);
      }
    }

    const problems = [...controlProblems, ...reconcile(tally, corpus)];
    const report = {
      base: ref,
      baseSha: execFileSync("git", ["rev-parse", "--short", ref], {
        cwd: REPO,
        encoding: "utf8",
      }).trim(),
      corpus: tally.documents,
      shapes: SHAPES.length,
      jsonFixtures: jsonFixtures.length,
      jsonFixturesMoved,
      tally: {
        ...tally,
        readDiagnosticsLostByCode: Object.fromEntries(tally.readDiagnosticsLostByCode),
      },
      byShape: Object.fromEntries(
        [...byShape].map(([k, t]) => [
          k,
          { ...t, readDiagnosticsLostByCode: Object.fromEntries(t.readDiagnosticsLostByCode) },
        ]),
      ),
      twins: { twins, twinsEqual, twinsHeadLouder, twinsHeadWeaker, twinExamples, louderExamples },
      problems,
    };

    if (asJson) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      const line = (label: string, value: number | string): void => {
        process.stdout.write(`  ${label.padEnd(52)} ${String(value)}\n`);
      };
      process.stdout.write(`\nread differential: ${ref} (${report.baseSha}) -> working tree\n\n`);
      line("documents", tally.documents);
      line("readings moved", tally.moved);
      process.stdout.write("\n  no-suppression bar\n");
      line("valid false -> true", tally.validFalseToTrue);
      line("valid true -> false", tally.validTrueToFalse);
      line("safeToSummarize false -> true", tally.safeFalseToTrue);
      line("retractions lost", tally.retractionsLost);
      line("negations lost", tally.negationsLost);
      line("newly throwing", tally.newlyThrowing);
      line("emitted XML that does not re-read at head", tally.emittedUnreadable);
      line("emitted XML that re-reads to something else at head", tally.emittedUnstable);
      line("  of those, stable on base (a regression)", tally.emittedNewlyUnreadable);
      line("serializations REFUSED at head (bought, not lost)", tally.serializationRefused);
      line("leaf values base read", tally.leavesBaseRead);
      line("  not compared (head refused to serialize)", tally.leavesNotComparedRefused);
      line("  missing at head", tally.leavesMissingAtHead);
      line(
        "  now inside an opaque narrative (containment-checked)",
        tally.leavesRecoveredInsideNarrative,
      );
      line("read diagnostics lost", tally.readDiagnosticsLost);
      line("  of those, at a RESOLVING location", tally.readDiagnosticsLostResolvable);
      for (const [code, n] of [...tally.readDiagnosticsLostByCode].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        line(`  of those, ${code}`, n);
      }
      line("read diagnostics gained", tally.readDiagnosticsGained);
      line("validation findings lost", tally.validationFindingsLost);
      line("  of those, at a RESOLVING location", tally.validationFindingsLostResolvable);
      line("validation findings gained", tally.validationFindingsGained);
      line("JSON outputs shorter", tally.jsonShorter);
      line("XML outputs shorter", tally.xmlShorter);
      process.stdout.write("\n  what it bought\n");
      line("narrative-bearing documents", tally.narrativeBearing);
      line("  narrative preserved on base", tally.narrativePreservedBase);
      line("  narrative preserved at head", tally.narrativePreservedHead);
      process.stdout.write("\n  the twin comparand (head's spelling vs BASE's twin)\n");
      line("twin pairs", twins);
      line("  head reads exactly as base read the twin", twinsEqual);
      line("  head reads LOUDER than base read the twin", twinsHeadLouder);
      line("  head reads WEAKER than base read the twin", twinsHeadWeaker);
      for (const e of louderExamples) line("    louder example", e);
      for (const e of twinExamples) line("    weaker example", e);
      process.stdout.write(
        "\n  by shape: docs / moved / valid F->T / safe F->T / read-diag lost / narrative base -> head\n",
      );
      for (const [shape, t] of [...byShape].sort(([a], [b]) => a.localeCompare(b))) {
        process.stdout.write(
          `    ${shape.padEnd(34)} ${String(t.documents).padStart(4)} ${String(t.moved).padStart(4)} ` +
            `${String(t.validFalseToTrue).padStart(4)} ${String(t.safeFalseToTrue).padStart(4)} ` +
            `${String(t.readDiagnosticsLost).padStart(5)} ` +
            `${String(t.narrativePreservedBase).padStart(4)} -> ${String(t.narrativePreservedHead).padStart(4)}\n`,
        );
      }
      process.stdout.write("\n  untouched surfaces\n");
      line("JSON fixtures", jsonFixtures.length);
      line("  moved", jsonFixturesMoved);
      if (tally.examples.length > 0) {
        process.stdout.write("\n  first losses seen\n");
        for (const e of tally.examples.slice(0, 10)) process.stdout.write(`    ${e}\n`);
      }
      if (problems.length > 0) {
        process.stdout.write("\n  HARNESS PROBLEMS\n");
        for (const p of problems) process.stdout.write(`    ${p}\n`);
      }
      process.stdout.write("\n");
    }
    if (problems.length > 0) process.exitCode = 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await main();
