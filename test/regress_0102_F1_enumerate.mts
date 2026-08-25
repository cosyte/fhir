/**
 * Refuter enumerator for S0102-fhir-model-observation-1, impl gate ordinal 1.
 *
 * `pnpm run differential:read` prints "validation findings lost 461 / gained 153" and exits 0. Its
 * exit code gates on HARNESS PROBLEMS only, and its "of those, at a RESOLVING location" line is
 * `resolves()`, which merely asks whether the location string is non-empty and not `<withheld>`. So
 * neither number is evidence about AC4 on its own. This enumerates them.
 *
 * The corpus generator (SHAPES, elementInsertionPoints, withRootAttrs, buildCorpus) and the findings
 * channel of `read()` are copied VERBATIM from scripts/read-differential.ts so the enumeration is of
 * the same 1195 documents. That copy is self-validating: the run asserts documents === 1195,
 * lost === 461 and gained === 153 against the harness's own printed totals, and fails loudly if the
 * reproduction has drifted.
 *
 * Run: pnpm -C fhir exec tsx test/regress_0102_F1_enumerate.mts
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(REPO, "test", "__fixtures__");
const XHTML = "http://www.w3.org/1999/xhtml";

interface Codec {
  parseResourceXml: (xml: string) => { resource: unknown; issues: readonly unknown[] };
  validateResource: (r: unknown) => { valid: boolean; issues: readonly unknown[] };
  serializeResource: (r: never) => string;
  serializeResourceXml: (r: never) => string;
}

interface Shape {
  readonly id: string;
  readonly xml: string;
  readonly rootAttrs?: string;
  readonly narrative: boolean;
  readonly twin?: string;
}

// -- copied verbatim from scripts/read-differential.ts ------------------------------------------
const SHAPES: readonly Shape[] = [
  { id: "beside-caps-default", xml: `<div xmlns="${XHTML}">@<BR/></div>`, narrative: true, twin: `<div xmlns="${XHTML}">@<br/></div>` },
  { id: "beside-caps-prefixed", xml: "<h:div>@<h:BR/></h:div>", rootAttrs: ` xmlns:h="${XHTML}"`, narrative: true, twin: `<div xmlns="${XHTML}">@<br/></div>` },
  { id: "beside-caps-nodecl", xml: "<div>@<BR/></div>", narrative: true, twin: "<div>@<br/></div>" },
  { id: "beside-caps-multi", xml: `<div xmlns="${XHTML}">@<P>dose</P> then <BR/></div>`, narrative: true, twin: `<div xmlns="${XHTML}">@<p>dose</p> then <br/></div>` },
  { id: "inside-caps-default", xml: `<div xmlns="${XHTML}"><Table>@</Table></div>`, narrative: true, twin: `<div xmlns="${XHTML}"><table>@</table></div>` },
  { id: "inside-caps-prefixed", xml: "<h:div><h:Table>@</h:Table></h:div>", rootAttrs: ` xmlns:h="${XHTML}"`, narrative: true, twin: `<div xmlns="${XHTML}"><table>@</table></div>` },
  { id: "caps-modifier-extension", xml: `<div xmlns="${XHTML}"><Table><modifierExtension url="urn:x"/>@</Table></div>`, narrative: true, twin: `<div xmlns="${XHTML}"><table><modifierExtension url="urn:x"/>@</table></div>` },
  { id: "caps-status-retraction", xml: `<div xmlns="${XHTML}"><Observation><status value="entered-in-error"/>@</Observation></div>`, narrative: true, twin: `<div xmlns="${XHTML}"><observation><status value="entered-in-error"/>@</observation></div>` },
  { id: "caps-resource-shaped", xml: `<div xmlns="${XHTML}"><Patient><id value="p"/>@</Patient></div>`, narrative: true, twin: `<div xmlns="${XHTML}"><patient><id value="p"/>@</patient></div>` },
  { id: "plain-default", xml: `<div xmlns="${XHTML}"><p>@</p></div>`, narrative: true },
  { id: "plain-text-only", xml: `<div xmlns="${XHTML}">@</div>`, narrative: true },
  { id: "plain-prefixed", xml: "<h:div><h:p>@</h:p></h:div>", rootAttrs: ` xmlns:h="${XHTML}"`, narrative: true },
  { id: "plain-nodecl", xml: "<div><p>@</p></div>", narrative: true },
  { id: "prefixed-modifier-extension", xml: '<h:div><h:p><h:modifierExtension url="urn:x"/>@</h:p></h:div>', rootAttrs: ` xmlns:h="${XHTML}"`, narrative: true },
  { id: "vendor-div-unprefixed", xml: '<div xmlns="urn:vendor"><Table>@</Table></div>', narrative: true },
  { id: "vendor-div-prefixed", xml: "<v:div><v:Table>@</v:Table></v:div>", rootAttrs: ' xmlns:v="urn:vendor"', narrative: false },
  { id: "escape-lt-in-uri", xml: `<div xmlns="${XHTML}"><V:x/>@</div>`, rootAttrs: ' xmlns:V="urn:a&lt;b"', narrative: true },
  { id: "escape-amp-quote", xml: `<div xmlns="${XHTML}" title="a&amp;b&quot;c"><BR/>@</div>`, narrative: true },
  { id: "div-with-value-attr", xml: `<div xmlns="${XHTML}" value="v">@<BR/></div>`, narrative: true },
  { id: "contained-stray-text", xml: '<contained>@<Observation><status value="final"/></Observation></contained>', narrative: false },
  { id: "contained-stray-text-retracted", xml: '<contained>@<Observation><status value="entered-in-error"/></Observation></contained>', narrative: false },
  { id: "contained-clean", xml: '<contained><Observation><status value="final"/>@</Observation></contained>', narrative: false },
  { id: "contained-stray-text-both-sides", xml: '<contained>@<Observation>inner<status value="final"/></Observation></contained>', narrative: false },
  { id: "contained-foreign-default-stray-text", xml: '<contained xmlns="urn:vendor">@<AllergyIntolerance><id value="a"/></AllergyIntolerance></contained>', narrative: false },
  { id: "primitive-text-not-value", xml: "<status>@</status>", narrative: false },
  { id: "uppercase-div-wrapper", xml: `<DIV xmlns="${XHTML}">@<BR/></DIV>`, narrative: true },
  { id: "entry-resource-stray-text", xml: '<entry><resource>@<Patient><id value="p"/></Patient></resource></entry>', narrative: false },
];

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

function withRootAttrs(xml: string, attrs: string): string {
  const close = xml.indexOf(">");
  if (close === -1) return xml;
  const selfClosing = xml[close - 1] === "/";
  const at = selfClosing ? close - 1 : close;
  return xml.slice(0, at) + attrs + xml.slice(at);
}

interface Doc {
  readonly name: string;
  readonly xml: string;
  readonly shape: string | undefined;
}

function buildCorpus(): Doc[] {
  const docs: Doc[] = [];
  const xmlFixtures = readdirSync(FIXTURES).filter((f) => f.endsWith(".xml")).sort();
  for (const file of xmlFixtures) {
    const base = readFileSync(join(FIXTURES, file), "utf8").trim();
    docs.push({ name: file, xml: base, shape: undefined });
    const points = elementInsertionPoints(base);
    for (const [pi, point] of points.entries()) {
      for (const shape of SHAPES) {
        const sentinel = `SENTINEL-${file}-${String(pi)}-${shape.id}`;
        const insert = (fragment: string): string => {
          const body = base.slice(0, point) + fragment.replaceAll("@", sentinel) + base.slice(point);
          return shape.rootAttrs === undefined ? body : withRootAttrs(body, shape.rootAttrs);
        };
        docs.push({ name: `${file}#${String(pi)}:${shape.id}`, xml: insert(shape.xml), shape: shape.id });
      }
    }
  }
  return docs;
}

const REFUSED = "<refused>";
function emitOrRefuse(write: () => string): string {
  try {
    return write();
  } catch (error) {
    if (error instanceof Error && error.name === "FhirSerializeError") return REFUSED;
    throw error;
  }
}

/** The findings channel of `read()`, plus the resource type the reading saw. */
function findingsOf(codec: Codec, xml: string): { findings: string[]; rt: string } {
  try {
    const { resource } = codec.parseResourceXml(xml);
    const v = codec.validateResource(resource);
    const findings = v.issues
      .map((i) => {
        const r = i as { code?: unknown; severity?: unknown; expression?: unknown };
        return `${String(r.code)}/${String(r.severity ?? "")}@${String(r.expression ?? "")}`;
      })
      .sort();
    emitOrRefuse(() => codec.serializeResource(resource as never));
    emitOrRefuse(() => codec.serializeResourceXml(resource as never));
    const rt = (resource as { properties?: { name: string; value?: { value?: unknown } }[] })
      .properties?.find((p) => p.name === "resourceType")?.value?.value;
    return { findings, rt: typeof rt === "string" ? rt : "(none)" };
  } catch {
    return { findings: [], rt: "(threw)" };
  }
}

async function loadBase(ref: string): Promise<{ codec: Codec; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "fhir-refute-0102-"));
  const archive = execFileSync("git", ["archive", ref, "src"], {
    cwd: REPO,
    maxBuffer: 256 * 1024 * 1024,
    encoding: "buffer",
  });
  execFileSync("tar", ["-x", "-C", dir], { input: archive });
  const codec = (await import(pathToFileURL(join(dir, "src", "index.ts")).href)) as Codec;
  return { codec, dir };
}

function bump(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}
function dump(label: string, m: Map<string, number>): void {
  console.log(`\n  ${label}`);
  for (const [k, n] of [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`    ${String(n).padStart(5)}  ${k}`);
  }
}

const { codec: base, dir } = await loadBase("origin/main");
const head = (await import(pathToFileURL(join(REPO, "src", "index.ts")).href)) as Codec;
try {
  const corpus = buildCorpus();
  let lost = 0;
  let gained = 0;
  const lostByCode = new Map<string, number>();
  const lostBySeverity = new Map<string, number>();
  const lostByDocType = new Map<string, number>();
  const lostFull = new Map<string, number>();
  const gainedByCode = new Map<string, number>();
  const gainedByRoot = new Map<string, number>();
  const gainedFull = new Map<string, number>();
  const gainedNonObservation: string[] = [];
  const lostNonNotModeled: string[] = [];

  for (const doc of corpus) {
    const b = findingsOf(base, doc.xml);
    const h = findingsOf(head, doc.xml);
    const headSet = new Set(h.findings);
    const baseSet = new Set(b.findings);
    for (const f of b.findings) {
      if (headSet.has(f)) continue;
      lost += 1;
      const code = f.slice(0, f.indexOf("/"));
      const severity = f.slice(f.indexOf("/") + 1, f.indexOf("@"));
      bump(lostByCode, code);
      bump(lostBySeverity, severity);
      bump(lostByDocType, `${b.rt} (document resourceType as base read it)`);
      bump(lostFull, f);
      if (code !== "RESOURCE_NOT_MODELED" || f.slice(f.indexOf("@") + 1) !== "Observation") {
        lostNonNotModeled.push(`${doc.name}: ${f}`);
      }
    }
    for (const f of h.findings) {
      if (baseSet.has(f)) continue;
      gained += 1;
      bump(gainedByCode, f.slice(0, f.indexOf("/")));
      const expression = f.slice(f.indexOf("@") + 1);
      const root = expression.split(".")[0] ?? "(none)";
      bump(gainedByRoot, root);
      bump(gainedFull, f);
      if (!expression.startsWith("Observation.")) gainedNonObservation.push(`${doc.name}: ${f}`);
    }
  }

  console.log(`documents ${String(corpus.length)}   lost ${String(lost)}   gained ${String(gained)}`);
  dump("lost, by code", lostByCode);
  dump("lost, by severity", lostBySeverity);
  dump("lost, by containing document resourceType", lostByDocType);
  dump("lost, verbatim", lostFull);
  dump("gained, by code", gainedByCode);
  dump("gained, by expression root", gainedByRoot);
  dump("gained, verbatim", gainedFull);
  console.log(`\n  lost that is NOT RESOURCE_NOT_MODELED@Observation: ${String(lostNonNotModeled.length)}`);
  for (const e of lostNonNotModeled.slice(0, 20)) console.log(`    ${e}`);
  console.log(`  gained NOT under an Observation. path: ${String(gainedNonObservation.length)}`);
  for (const e of gainedNonObservation.slice(0, 20)) console.log(`    ${e}`);

  const drift: string[] = [];
  if (corpus.length !== 1195) drift.push(`documents ${String(corpus.length)} != 1195`);
  if (lost !== 461) drift.push(`lost ${String(lost)} != 461`);
  if (gained !== 153) drift.push(`gained ${String(gained)} != 153`);
  console.log(
    drift.length === 0
      ? "\nREPRODUCTION MATCHES THE HARNESS (1195 / 461 / 153)"
      : `\nREPRODUCTION DRIFTED: ${drift.join("; ")}`,
  );
  process.exit(drift.length === 0 ? 0 : 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
