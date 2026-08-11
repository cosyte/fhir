#!/usr/bin/env tsx
/**
 * `@cosyte/fhir` PHI scanner: the CI / pre-commit half of the PHI commit-gate.
 *
 * ===========================================================================
 * WHAT IS IN THIS FILE, AND WHAT IS NOT.
 *
 * The MACHINERY is `@cosyte/script-utils/phi-scan`, a devDependency: argument
 * parsing, the allow-list and override log, target enumeration on all three
 * routes, the union of the working-tree walk with the bytes git carries,
 * content deduplication, THE COMPLETENESS RULE, every refusal, and the
 * cross-cutting SSN/email FLOOR. Read that module's docblock for what each rule
 * closes and what it costs; nothing is restated here, because a claim written
 * down twice is a claim that drifts.
 *
 * IT IS A DEPENDENCY AND NOT A COPY, AND THAT IS THE POINT. This file used to
 * carry the whole engine, and every sibling parser carried its own copy, so a
 * newly-found escape cost one pull request and one adversarial review PER REPO.
 * Three escape classes have been paid for that way already. Now it costs one
 * pull request in `cosyte/config` and a version bump here.
 *
 * WHAT STAYS LOCAL is what genuinely differs: THE FIVE PER-REPO AXES below, and
 * the FHIR-SPECIFIC FIELD DETECTION in `detect` at the bottom of this file.
 *
 * It is a devDependency and never a runtime one. The zero-dep rule governs what
 * ships; a dev-time gate does not ship.
 * ===========================================================================
 *
 * ===========================================================================
 * EXIT CONTRACT, DEFINED HERE AND NOT INHERITED:
 *
 *   0  the scan ran, READ EVERY TARGET IT ENUMERATED, and found nothing.
 *   1  HITS. Reserved for "this corpus contains something that looks like PHI".
 *      It is NOT exclusive: an allow-list, or an override log, that EXISTS but
 *      cannot be READ throws a plain `Error` and takes node's own exit 1, which
 *      a caller reads as "hits found". The engine names that escape rather than
 *      claiming to have closed it.
 *   2  EVERY STATE THE ENGINE RAISES IN WHICH THE SCAN CANNOT ACCOUNT FOR
 *      SOMETHING. The full list is in the engine's `run()` docblock.
 *
 * 1 IS RESERVED BECAUSE CI AND THE PRE-COMMIT HOOK BRANCH ON THE CODE. A caller
 * must be able to tell "PHI was found here" from "this scan is not trustworthy".
 *
 * DO NOT PORT THESE NUMBERS INTO, OR OUT OF, A SIBLING PARSER. The `@cosyte/*`
 * scanners do not agree on them and are not required to.
 * ===========================================================================
 */

import { runPhiScan, type DetectContext } from "@cosyte/script-utils/phi-scan";

// ===========================================================================
// ██  THE FIVE PER-REPO AXES  ███████████████████████████████████████████████
// ===========================================================================
//
// A PORT IS NOT A COPY. Five things genuinely differ between the sibling
// `@cosyte/*` scanners, and every one of them is a PARAMETER of the shared
// engine rather than a fork of it. Re-derived HERE against what this repo's own
// scanner did before the adoption:
//
//   1. EXIT CODES        `EXIT_CODES`. No default exists, deliberately.
//   2. ROOTS+EXCLUSIONS  `SCAN_ROOTS`, `EXCLUDED_PATHS`, and the READ filter.
//   3. `--staged` SCOPE  `isStagedReadable`.
//   4. GITLINKS          `regularBlobModes`, defaulted by the engine to git's
//                        two regular-blob modes. Nothing to set here: this repo
//                        used the same two.
//   5. EOL NORMALIZATION No parameter: the engine's walk/index deduplication is
//                        BY CONTENT, so a repo whose index carries LF and whose
//                        working tree carries CRLF scans BOTH forms. This repo
//                        relied on exactly that and still does; it is listed
//                        because a port must CHECK it, not skip it.
// ===========================================================================

/** AXIS 1: this repo's exit contract, stated in the header block above. */
const EXIT_CODES = { clean: 0, hits: 1, refuse: 2 } as const;

/**
 * AXIS 2: the roots the sweep walks, and the ROOT half of scope for every
 * refusal that keys on it.
 *
 * THE WHOLE REPOSITORY, AND THAT IS A WIDENING OF THE WALK WITH A MEASUREMENT
 * BEHIND IT RATHER THAN A DEFAULT TAKEN ON TRUST. The scanner this file
 * replaces walked `test` and `src`, and then read the index REPO-WIDE as a
 * separate route with no root filter at all, so its effective corpus was
 * `(walk of test + src) UNION (every tracked non-markdown blob, anywhere)`.
 * The engine keys BOTH halves on one root set, so `["test", "src"]` here would
 * have STOPPED READING every tracked file outside those two directories:
 * `package.json`, `scripts/*.ts`, `docs-content/`, `.github/`, `.changeset/`
 * and the root manifests. That is not a hypothetical loss. This repo's
 * allow-list carries an `EMAILDOMAIN cosyte.com` line whose own comment records
 * that it became necessary when the sweep started reading `package.json`, so
 * narrowing to the old walk roots would have withdrawn a file the corpus is
 * currently declared against.
 *
 * So the root set is the repository, which keeps every path the old scanner
 * read and adds the one thing the old walk could not see: UNTRACKED
 * working-tree content outside `test/` and `src/`. The engine prunes gitignored
 * directories during descent and skips `.git` by name, so `node_modules`,
 * `dist` and `coverage` cost nothing.
 *
 * BE EXACT ABOUT WHAT "EVERYTHING" READS, BECAUSE IT IS NOT EVERY TRACKED FILE.
 * A `.md` path is dropped by the shared read exemption on both sweeping routes,
 * and the entries in `EXCLUDED_PATHS` below are read by no route at all. "The
 * whole repository" is the ROOT half of scope and is not a claim that every
 * tracked file is opened.
 */
const SCAN_ROOTS: readonly string[] = ["."];

/**
 * AXIS 2 (the subtractive half): repo-relative paths NO route reads: not the
 * walk, not the index union, not `--staged`.
 *
 * Files whose whole POINT is to carry realistic-PHI-shaped strings. Scanning
 * them would flag the very sentinels that exist to be flagged. Declared by
 * exact path rather than by directory: a new test file under `test/` is in
 * scope by default, and adding to this set is a reviewed act recorded in
 * `phi-scan-overrides.md`.
 *
 * 🛑 EXCLUDE A LITERAL PATH, NEVER A CLASS. A sibling measured what a
 * predicate costs: two of its hand-written sources embed NUL bytes as HMAC
 * domain separators, so git's own binary heuristic calls them binary and a
 * "skip binary blobs" predicate would have dropped them out of the corpus
 * silently. A literal path is reviewable in a diff; a class quietly grows new
 * members.
 *
 * AN ENTRY HERE IS A FILE THE SCAN HAS NO VERDICT ABOUT, so each one says why.
 *
 * 🛑 THE ENGINE DROPS THESE SILENTLY, WHICH IS A CHANGE FROM THE SCANNER THIS
 * FILE REPLACES: that one printed `skipping N declared sentinel file(s)` on the
 * sweeping routes, on the argument that an exemption nobody sees is the same
 * shape of blind spot the gate exists to refuse. The announcement is NOT
 * reimplemented here, because knowing which excluded paths a run would
 * otherwise have enumerated is the engine's own bookkeeping and a local copy of
 * it is the machinery this adoption exists to delete. It is recorded in
 * `phi-scan-overrides.md` as an engine-side ask instead.
 */
const EXCLUDED_PATHS: ReadonlySet<string> = new Set<string>([
  // The redaction-contract sentinel battery: its values exist to be flagged.
  "test/phi-leak.test.ts",
  // This scanner's own test, which must spell out the values it is meant to
  // catch.
  "test/scripts/phi-scan.test.ts",
  // This file. Its docblocks have to spell out the violator values they
  // explain, and one of them is an email at a plausible real hospital domain.
  // The token-level remedy would be an `EMAILDOMAIN` line, which is GLOBAL and
  // ROUTE-BLIND: it would admit that domain in a fixture too. A literal path is
  // the narrower of the two.
  "scripts/phi-scan.ts",
]);

/**
 * AXIS 3: the READ half of scope for `--staged`, i.e. which regular blobs a
 * COMMIT is blocked on.
 *
 * IT IS UNCHANGED FROM THE SCANNER THIS FILE REPLACES, AND THAT IS DELIBERATE
 * EVEN THOUGH THE SWEEP'S ROOTS WIDENED ABOVE. Widening `--staged` changes what
 * a commit is BLOCKED on, which is a hook decision taken on its own evidence: a
 * sibling has declined it three times for that reason. The two routes were
 * already asymmetric here before this change (the sweep's index half read the
 * whole tracked tree while the hook read `test/**` and `src/**.ts`), so keeping
 * this predicate exactly as it was preserves the hook's behaviour rather than
 * quietly re-deciding it inside an adoption.
 *
 * 🛑 THIS IS NOT `isUnderScanRoot`. The engine's non-regular and non-blob
 * refusals key on the ROOT half of scope, never on this read filter: a
 * `.md`-named symbolic link must be refused on both routes even though no route
 * would read a `.md` FILE. A link's name is no evidence about what is on the
 * other side of it. Two sibling ports collapsed the two predicates and both had
 * the routes disagree about the same entry.
 *
 * IT STAYS INSIDE `SCAN_ROOTS`, AND THE ENGINE ENFORCES THAT RATHER THAN
 * ASSUMING IT. With the roots at the repository that containment is total, so
 * the enforcement cannot fire here today; it is the engine's check and not this
 * file's claim.
 */
function isStagedReadable(relPath: string): boolean {
  if (relPath.toLowerCase().endsWith(".md")) return false;
  if (relPath === "test" || relPath.startsWith("test/")) return true;
  if (relPath === "src") return true;
  return relPath.startsWith("src/") && relPath.endsWith(".ts");
}

// ===========================================================================
// ██  FHIR-SPECIFIC FIELD DETECTION  ████████████████████████████████████████
// ===========================================================================
//
// The half the shared engine deliberately does not own, because it differs per
// healthcare standard. The engine has already run the cross-cutting floor
// (dashed SSN + email at an undeclared domain) over the same bytes and reported
// any hits against the correct locus. Everything below is this package's.
//
// A FHIR resource carries PHI by design (names, dates of birth, SSNs, MRNs,
// addresses, phones / emails). A JSON resource *could* carry an inline
// `"_synthetic": true` marker, but that would corrupt the very round-trip the
// fixtures prove, so this package uses the same proven mechanism the
// byte-strict siblings use: `scripts/phi-allow-list.txt` is the positive
// declaration that a fixture's identifiers are fake, and every detector below
// consults it.
//
// Detection is FHIR-SHAPE-AWARE, NOT a blind text regex: a document is parsed
// (JSON / NDJSON) or its element/value-attribute pairs are read (XML), and only
// the elements that actually carry each PHI category are inspected, keyed by
// the FHIR element name. That is deliberate: a `name` that is a plain string
// (`Organization.name`, `StructureDefinition.name`) is a resource label, not a
// person, and is never name-scanned; only a HumanName object/array is.
// ===========================================================================

/**
 * Name tokens that are honorific / degree / suffix codes, never a person's
 * identifying name, extracted alongside real name tokens and skipped.
 */
const NAME_NOISE_TOKENS = new Set<string>([
  "MD",
  "DO",
  "DR",
  "MR",
  "MRS",
  "MS",
  "MISS",
  "JR",
  "SR",
  "II",
  "III",
  "IV",
  "RN",
  "NP",
  "PA",
  "PHD",
  "DDS",
  "DMD",
  "ESQ",
  "PROF",
  "FNP",
  "APRN",
]);

/** Escape a literal string for embedding in a RegExp. */
function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Unicode-aware name tokenizer: significant tokens only (middle initials dropped). */
function nameTokens(value: string): string[] {
  const out: string[] = [];
  for (const raw of value.split(/[^\p{L}]+/u)) {
    if (raw.length === 0) continue;
    if (!/\p{L}/u.test(raw)) continue;
    // A single Latin letter is a middle initial, not identifying. A single CJK
    // ideograph / kana / hangul IS a name (Chinese/Korean surnames are 1 char).
    const isCjk = /[぀-ヿ㐀-鿿가-힯]/u.test(raw);
    if (raw.length < 2 && !isCjk) continue;
    out.push(raw);
  }
  return out;
}

function isEmailShaped(value: string): boolean {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value.trim());
}

/**
 * A date, reduced to the digits a comparison can be made on: `YYYYMMDD`,
 * `YYYYMM` or `YYYY`. `null` for anything that is not a date at all.
 *
 * BOTH SIDES ARE NORMALIZED BY THIS FUNCTION, AND THAT IS THE ENGINE'S OWN
 * CONTRACT RATHER THAN A LOCAL INVENTION: `AllowList.dobs` is documented as
 * holding the declared dates "in whatever form the caller's detector normalises
 * to", so the engine keeps the `DOB` lines verbatim and this file reduces the
 * declared values and the found value the same way. A declaration written
 * `1974-12-25` therefore answers a document that spells it `19741225`.
 */
function normalizeDob(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8) {
    const d = digits.slice(0, 8);
    const month = Number(d.slice(4, 6));
    const day = Number(d.slice(6, 8));
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return d;
  }
  if (/^\d{6}$/.test(digits)) {
    const month = Number(digits.slice(4, 6));
    if (month < 1 || month > 12) return null;
    return digits;
  }
  if (/^\d{4}$/.test(digits)) return digits; // year-only precision
  return null;
}

/** The declared dates of birth, reduced the same way a found value is. */
function declaredDobs(allow: DetectContext["allow"]): Set<string> {
  const out = new Set<string>();
  for (const raw of allow.dobs) {
    const norm = normalizeDob(raw);
    if (norm !== null) out.add(norm);
  }
  return out;
}

/**
 * One target's detection state: the context, plus the declared dates reduced
 * once rather than once per date encountered.
 */
interface Scan {
  ctx: DetectContext;
  dobs: Set<string>;
}

// ---------------------------------------------------------------------------
// Category detectors. Each one consults the allow-list, without exception.
// ---------------------------------------------------------------------------
//
// 🛑 A DETECTOR THAT DOES NOT CONSULT `ctx.allow` HAS NO REMEDY AT ALL, because
// the `--allow-fixture` whole-file bypass is recorded and then REFUSED by the
// engine and cannot reach a clean run in any mode. A sibling shipped a phone
// detector and a dashed-SSN branch that consulted nothing while its footer
// claimed the token allow-list was the only remedy, and its reviewer caught the
// claim as false: it was not a remedy for those two at all.

function checkNameString(s: Scan, segment: string, value: string): void {
  for (const tok of nameTokens(value)) {
    if (NAME_NOISE_TOKENS.has(tok.toUpperCase())) continue;
    if (s.ctx.allow.names.has(tok.toUpperCase())) continue;
    s.ctx.hit({
      segment,
      value: tok,
      reason: "person-name token not in synthetic allow-list",
    });
  }
}

function checkDate(s: Scan, segment: string, value: string): void {
  const dob = normalizeDob(value);
  if (dob === null) return;
  if (s.dobs.has(dob)) return;
  s.ctx.hit({ segment, value, reason: "date of birth not in synthetic allow-list" });
}

/**
 * A street address line.
 *
 * 🩺 IT READS `allow.ids`, AND THAT IS AN INTERIM WITH AN ENGINE-SIDE ASK
 * BEHIND IT. The scanner this file replaces parsed its own `ADDR` tag out of
 * `scripts/phi-allow-list.txt` into an `addresses` set. The shared
 * `AllowList` models `names`, `dobs`, `ids` and `emailDomains` and has no
 * address set, and re-reading the allow-list here to recover one would be a
 * local copy of the engine's own parsing: the machinery this adoption exists to
 * delete. So a synthetic street line is declared with the `ID` tag, which the
 * engine already parses and uppercases, and the allow-list's own header says
 * so. The ask filed against the engine is an `addresses` set parsed from `ADDR`
 * (address is one of the five PHI categories the engine's own docs name as the
 * caller's), after which this line becomes `allow.addresses` and the tag moves
 * back. NOTHING IN THIS REPO'S ALLOW-LIST MOVES WITH IT TODAY: there is no
 * `ADDR` line to migrate, so this changes the SPELLING of a remedy nobody has
 * had to use yet, and no verdict over the current corpus.
 */
function checkAddressLine(s: Scan, segment: string, value: string): void {
  const street = value.trim();
  // A street line: house number + at least one word (`123 Main St`).
  if (!/^\d+\s+\p{L}/u.test(street)) return;
  if (s.ctx.allow.ids.has(street.toUpperCase())) return;
  s.ctx.hit({ segment, value: street, reason: "street address not in synthetic allow-list" });
}

/** A ContactPoint.value or Identifier.value: phone / email / SSN shape checks. */
function checkContactValue(s: Scan, segment: string, value: string): void {
  const v = value.trim();
  if (v.length === 0) return;
  if (isEmailShaped(v)) {
    const domain = (v.split("@")[1] ?? "").toLowerCase();
    if (!s.ctx.allow.emailDomains.has(domain)) {
      s.ctx.hit({ segment, value: v, reason: "email with non-test domain" });
    }
    return;
  }
  const digits = v.replace(/\D/g, "");
  // A 9-digit value is SSN-shaped; declare it synthetic in the allow-list.
  if (/^\d{9}$/.test(digits) && !s.ctx.allow.ids.has(digits.toUpperCase())) {
    s.ctx.hit({
      segment,
      value: v,
      reason: "SSN- / 9-digit-identifier-shaped value not in synthetic allow-list",
    });
    return;
  }
  // A real dialable phone is >= 10 digits. The `555` fake-exchange convention
  // (555-01xx is reserved for fiction) marks a synthetic number.
  if (digits.length >= 10 && !digits.includes("555") && !s.ctx.allow.ids.has(digits.toUpperCase())) {
    s.ctx.hit({
      segment,
      value: v,
      reason: "phone number without the 555 fake-exchange convention",
    });
  }
}

// ---------------------------------------------------------------------------
// The FHIR JSON / NDJSON structured scanner
// ---------------------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Scan a HumanName object/array. A string `name` is a resource label, skipped. */
function scanHumanName(s: Scan, node: unknown, segment: string): void {
  if (Array.isArray(node)) {
    for (const item of node) scanHumanName(s, item, segment);
    return;
  }
  if (!isRecord(node)) return; // a plain-string `name` is not a person
  for (const key of ["family", "text"] as const) {
    const v = node[key];
    if (typeof v === "string") checkNameString(s, `${segment}.${key}`, v);
  }
  const given = node["given"];
  if (typeof given === "string") checkNameString(s, `${segment}.given`, given);
  else if (Array.isArray(given)) {
    for (const g of given) {
      if (typeof g === "string") checkNameString(s, `${segment}.given`, g);
    }
  }
  // prefix / suffix are honorifics / generational suffixes, not scanned.
}

function scanTelecom(s: Scan, node: unknown, segment: string): void {
  if (Array.isArray(node)) {
    for (const item of node) scanTelecom(s, item, segment);
    return;
  }
  if (!isRecord(node)) return;
  const v = node["value"];
  if (typeof v === "string") checkContactValue(s, `${segment}.value`, v);
}

function scanAddress(s: Scan, node: unknown, segment: string): void {
  if (Array.isArray(node)) {
    for (const item of node) scanAddress(s, item, segment);
    return;
  }
  if (!isRecord(node)) return;
  const line = node["line"];
  if (typeof line === "string") checkAddressLine(s, `${segment}.line`, line);
  else if (Array.isArray(line)) {
    for (const l of line) {
      if (typeof l === "string") checkAddressLine(s, `${segment}.line`, l);
    }
  }
  const text = node["text"];
  if (typeof text === "string") checkAddressLine(s, `${segment}.text`, text);
}

function scanIdentifier(s: Scan, node: unknown, segment: string): void {
  if (Array.isArray(node)) {
    for (const item of node) scanIdentifier(s, item, segment);
    return;
  }
  if (!isRecord(node)) return;
  const v = node["value"];
  if (typeof v === "string") checkContactValue(s, `${segment}.value`, v);
}

/**
 * Walk the parsed resource. Known PHI-bearing element keys are dispatched to
 * their category detector; every value is then recursed into so a nested
 * resource (`contained`, `entry.resource`, an extension's `value[x]`) is
 * reached. The dispatch keys are never recursed *as* their category twice: the
 * generic recursion into e.g. a HumanName object visits `family` / `given` as
 * bare strings, which are not dispatch keys.
 */
function walkResource(s: Scan, node: unknown, segment: string): void {
  if (Array.isArray(node)) {
    for (const item of node) walkResource(s, item, segment);
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const child = `${segment}.${key}`;
    switch (key) {
      case "name":
        scanHumanName(s, value, child);
        break;
      case "telecom":
        scanTelecom(s, value, child);
        break;
      case "address":
        scanAddress(s, value, child);
        break;
      case "identifier":
        scanIdentifier(s, value, child);
        break;
      case "birthDate":
      case "deceasedDateTime":
        if (typeof value === "string") checkDate(s, child, value);
        break;
      default:
        break;
    }
    walkResource(s, value, child);
  }
}

function rootLabel(node: unknown): string {
  if (isRecord(node) && typeof node["resourceType"] === "string") return node["resourceType"];
  return "resource";
}

// ---------------------------------------------------------------------------
// The FHIR XML structured scanner
// ---------------------------------------------------------------------------

/** Extract every `value` attribute of an element named `<tag …/>`. */
function xmlValues(text: string, tag: string): string[] {
  const re = new RegExp(`<${reEscape(tag)}\\b[^>]*\\bvalue="([^"]*)"`, "g");
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

function scanXmlText(s: Scan, text: string): void {
  // FHIR XML represents primitives as `<element value="…"/>`. Inspect only the
  // PHI-bearing element names, mirroring the JSON element map.
  for (const v of xmlValues(text, "family")) checkNameString(s, "name.family", v);
  for (const v of xmlValues(text, "given")) checkNameString(s, "name.given", v);
  for (const tag of ["birthDate", "deceasedDateTime"]) {
    for (const v of xmlValues(text, tag)) checkDate(s, tag, v);
  }
  for (const v of xmlValues(text, "line")) checkAddressLine(s, "address.line", v);
  // ContactPoint.value / Identifier.value serialize as `<value value="…"/>`,
  // but so does the overloaded `Quantity.value` (`<value value="70.0"/>`).
  // Scope the value scan to inside a `<telecom>` / `<identifier>` block so a
  // numeric measurement is never misread as a phone / SSN.
  for (const tag of ["telecom", "identifier"]) {
    const blockRe = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
    for (const block of text.matchAll(blockRe)) {
      for (const v of xmlValues(block[1] ?? "", "value")) {
        checkContactValue(s, `${tag}.value`, v);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The FHIR-keyed literal recogniser (hand-written source)
// ---------------------------------------------------------------------------

/**
 * ENUMERATING A FILE BUYS THE SSN / EMAIL FLOOR AND NOTHING ELSE, so widening
 * the scope without widening this is half a fix.
 *
 * The structured scanners above assume THE FILE IS THE DOCUMENT. A test builds
 * its resources as TypeScript object literals instead, so a real surname typed
 * as `family: "…"` inside a `.ts` file is read by NOTHING otherwise: the
 * engine's floor looks for a dashed SSN and an email, and neither is a name, a
 * date of birth or a street address. Measured on a `.ts` file carrying
 * `{ resourceType: "Patient", name: [{ family: "…", given: ["…"] }] }`: exit 0,
 * no hits, with this recogniser absent.
 *
 * The key set is closed and small, and every omission is deliberate:
 *
 *   - `text` is NOT keyed. `HumanName.text` and `Address.text` are PHI, but a
 *     flat text pass cannot tell them from `CodeableConcept.text`,
 *     `Narrative.text` or an assertion message, all of which are ordinary in
 *     this suite. Keying it would false-error on conformant test code, which is
 *     the failure that gets a gate switched off.
 *   - `identifier.value` and `telecom.value` are NOT keyed, for the same reason
 *     and more sharply: bare `value` is the single most overloaded key in FHIR
 *     (`Quantity.value`, `Extension.value[x]`, every primitive), and the XML
 *     scanner only dares read it inside a `<telecom>` / `<identifier>` block.
 *     There is no equivalent block boundary in TypeScript source.
 *
 * So this recogniser covers NAMES, DATES OF BIRTH AND STREET ADDRESSES in
 * source. It is not a claim that source is scanned as thoroughly as a document;
 * a 9-digit identifier written inline still reaches only the engine's floor.
 */
const SOURCE_LITERAL_KEYS =
  /(?:^|[^\w$.])\\?["'`]?(family|given|birthDate|deceasedDateTime|line)\\?["'`]?\s*:\s*/g;

/**
 * A `${…}` substitution span, replaced by a space before anything is tokenized.
 *
 * NOT skipped, and not read either. Reading it reported the EXPRESSION as a
 * person name: `` family: `${surname}` `` produced a hit whose value was
 * `surname`, which is a variable, not anybody's name, and a gate that invents
 * findings is a gate that gets ignored. Skipping the whole literal would drop
 * the XML resources this suite writes as template literals with an interpolated
 * namespace declaration, which is most of them. Blanking the span keeps every
 * character the file spells out and reads none that it computes.
 */
const TEMPLATE_SUBSTITUTION = /\$\{[^{}]*\}/g;

/**
 * An XML entity reference or numeric character reference, blanked for the same
 * reason a substitution is: it is a REFERENCE, not spelled-out content, and
 * neither XML pass in this scanner resolves one.
 *
 * A SPACE, NOT A DELETION, and the direction matters. Blanking can only split a
 * token apart, never join two, so it cannot hide a name that was written as
 * letters: `Smith&amp;Jones` reports both halves. Deleting would have joined
 * `A&#65;` into one token that the file never spells. Without this the entity
 * and XXE cases in this suite's own XML tests reported `amp`, `lt`, `gt`,
 * `xxe`, `lol`, `secret` and `xZZ` as person-name tokens, which are entity
 * names and nobody's name.
 *
 * THE RESIDUAL, WHICH THE XML DOCUMENT PASS HAS TOO AND ALWAYS HAS: a name
 * spelled ENTIRELY as character references is blanked to nothing and not
 * reported. The threat this gate is built for is an accidental commit, not an
 * author encoding a name to evade it, and a partially encoded name still
 * reports.
 */
const XML_ENTITY_REF = /&#?[A-Za-z0-9]+;/g;

/**
 * Decode the string escapes a TypeScript literal can spell a character with, so
 * a name is not hidden from the token check by the way it was typed. `"Roe"`
 * is `Roe` to every reader of the program and has to be `Roe` here too; this
 * suite already contains that spelling. Unknown escapes drop to their literal
 * character, which is what the language does for everything outside the short
 * list below.
 *
 * BOUNDED FIXED POINT, NOT ONE PASS, and the reason is in this suite already: a
 * resource is routinely written as a JSON document inside a TypeScript string,
 * so that value is TWO layers of escaping and one decode leaves a backslash-u
 * sequence whose only surviving name token is `Ro`, which nobody wrote.
 * Decoding until the text stops changing reads what the program reads. The
 * bound is a bound: this runs over source text and a fixed point is not
 * guaranteed to be reached cheaply, so three rounds is the cap. A fourth layer
 * of escaping is not decoded, and it fails toward reporting rather than away
 * from it: the residue still tokenizes and still has to clear the allow-list.
 */
function decodeSourceEscapes(raw: string): string {
  let out = raw;
  for (let round = 0; round < 3; round += 1) {
    const next = decodeSourceEscapesOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

function decodeSourceEscapesOnce(raw: string): string {
  return raw.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(.))/gs, (...m) => {
    const [, , braced, u4, x2, other] = m as (string | undefined)[];
    const hex = braced ?? u4 ?? x2;
    if (hex !== undefined) {
      const cp = Number.parseInt(hex, 16);
      // A lone surrogate is not a scalar value; leave the escape as written
      // rather than manufacturing U+FFFD, which would change the token.
      if (cp >= 0xd800 && cp <= 0xdfff) return `\\u${hex}`;
      try {
        return String.fromCodePoint(cp);
      } catch {
        return `\\u${hex}`;
      }
    }
    // The single-character escapes. Anything not named here drops to the
    // character itself, which is what the language does: `\q` is `q`, and `\\`
    // is one backslash.
    const single = other ?? "";
    switch (single) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "0":
        return "\0";
      default:
        return single;
    }
  });
}

/** How far past a matched key the value reader will look. */
const LITERAL_SCAN_LIMIT = 200_000;

function isQuote(c: string | undefined): boolean {
  return c === '"' || c === "'" || c === "`";
}

/**
 * Read one quoted string starting at `i`, or `null`. Returns the raw body.
 *
 * AN ESCAPED DELIMITER OPENS A STRING TOO, and missing that read nothing at all
 * for the commonest way this suite embeds a document: a JSON resource inside a
 * DOUBLE-quoted TypeScript string spells its keys and values `\"family\"`, so
 * both the key and the value begin with a backslash. The single-quoted spelling
 * has no backslash and always worked, which is exactly why the gap was easy to
 * miss.
 */
function readQuoted(text: string, i: number): { value: string; end: number } | null {
  let start = i;
  const escaped = text[i] === "\\" && isQuote(text[i + 1]);
  if (escaped) start = i + 1;
  const quote = text[start];
  if (!isQuote(quote)) return null;

  let j = start + 1;
  let body = "";
  while (j < text.length) {
    const c = text[j];
    if (c === undefined) break;
    if (escaped) {
      // The delimiter is the two-character sequence `\` + quote.
      if (c === "\\" && text[j + 1] === quote) return { value: body, end: j + 2 };
      body += c;
      j += 1;
      continue;
    }
    if (c === "\\") {
      body += c + (text[j + 1] ?? "");
      j += 2;
      continue;
    }
    if (c === quote) return { value: body, end: j + 1 };
    body += c;
    j += 1;
  }
  return null;
}

/** Advance past whitespace and both comment forms. */
function skipTrivia(text: string, i: number): number {
  let j = i;
  for (;;) {
    while (j < text.length && /\s/.test(text[j] ?? "")) j += 1;
    if (text.startsWith("//", j)) {
      const nl = text.indexOf("\n", j);
      if (nl < 0) return text.length;
      j = nl + 1;
      continue;
    }
    if (text.startsWith("/*", j)) {
      const close = text.indexOf("*/", j);
      if (close < 0) return text.length;
      j = close + 2;
      continue;
    }
    return j;
  }
}

/**
 * Read the string literal, or the array of string literals, that follows a
 * matched key.
 *
 * IT SCANS RATHER THAN SLICING A WINDOW, and the earlier window is why. A fixed
 * 4 KB slice with `indexOf("]")` for the array's end got BOTH ends wrong: a `]`
 * inside a string (`"742 Evergreen Terrace [Apt 4]"`) or inside an index
 * expression (`names[0]`) ended the array early and dropped every member after
 * it, and an array whose closing bracket sat past the window dropped ALL of its
 * members rather than the tail. Both failed toward reporting nothing, which is
 * the direction this gate must never fail in. The scan tracks quoting and
 * bracket depth, and its bound is a character budget, so a pathological input
 * stops the scan instead of the file.
 *
 * A non-string member (a number, an identifier, a call) contributes nothing;
 * this recogniser reports on values the file actually spells out.
 */
function readLiteralValues(text: string, from: number): string[] {
  const limit = Math.min(text.length, from + LITERAL_SCAN_LIMIT);
  let i = skipTrivia(text, from);
  if (i >= limit) return [];

  const direct = readQuoted(text, i);
  if (direct !== null) return [decodeSourceEscapes(direct.value)];
  if (text[i] !== "[") return [];

  const out: string[] = [];
  let depth = 0;
  while (i < limit) {
    const c = text[i];
    if (c === "[") {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === "]") {
      depth -= 1;
      if (depth === 0) return out;
      i += 1;
      continue;
    }
    const quoted = readQuoted(text, i);
    if (quoted !== null) {
      out.push(decodeSourceEscapes(quoted.value));
      i = quoted.end;
      continue;
    }
    i += 1;
  }
  // Unterminated within the budget: return what was read rather than nothing.
  return out;
}

/**
 * THIS PACKAGE READS TWO WIRE FORMATS AND ITS TESTS WRITE BOTH, so there are
 * two arms. The object-literal arm covers `family: "…"`; the XML arm runs the
 * same `xmlValues` extractor the document scanner uses over the whole text,
 * which covers `<family value="…"/>` written inside a template literal. Keying
 * only the first was measured leaving 33 `family` / `given` and 3 `birthDate`
 * XML `value` attributes unread in the 55 files under `test/` this scope once
 * admitted.
 *
 * SAY "TWO FORMATS", NEVER "BOTH SPELLINGS". That would be a claim about the
 * spellings WITHIN the XML format, and the XML arm covers ONE of the three this
 * suite uses: the double-quoted attribute. A single-quoted attribute
 * (`value='…'`) and XML ELEMENT TEXT (`<given>…</given>`) are both unread, and
 * the element-text case has a live site here. Declared in
 * `phi-scan-overrides.md` rather than guarded.
 */
function scanSourceLiterals(s: Scan, content: string): void {
  const text = content.replace(TEMPLATE_SUBSTITUTION, " ").replace(XML_ENTITY_REF, " ");

  SOURCE_LITERAL_KEYS.lastIndex = 0;
  for (const m of text.matchAll(SOURCE_LITERAL_KEYS)) {
    const key = m[1];
    if (key === undefined || m.index === undefined) continue;
    for (const value of readLiteralValues(text, m.index + m[0].length)) {
      dispatchSourceValue(s, key, value);
    }
  }

  // The XML spelling. `xmlValues` is the same extractor the document scanner
  // uses, so the two formats are read by one rule rather than two that drift.
  for (const key of ["family", "given", "birthDate", "deceasedDateTime", "line"] as const) {
    for (const value of xmlValues(text, key)) {
      dispatchSourceValue(s, key, decodeSourceEscapes(value));
    }
  }
}

function dispatchSourceValue(s: Scan, key: string, value: string): void {
  switch (key) {
    case "family":
    case "given":
      checkNameString(s, `(source) name.${key}`, value);
      break;
    case "birthDate":
    case "deceasedDateTime":
      checkDate(s, `(source) ${key}`, value);
      break;
    case "line":
      checkAddressLine(s, "(source) address.line", value);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** What the bytes ARE, decided by reading them. */
type Shape =
  | { kind: "json"; doc: unknown }
  | { kind: "ndjson"; docs: { doc: unknown; line: number }[] }
  | { kind: "xml" }
  | { kind: "source" };

/**
 * WHICH DETECTOR THE BYTES DISPATCH TO, DECIDED BY THE CONTENT AND NOT BY THE
 * PATH, AND THAT IS A CHANGE FROM THE SCANNER THIS FILE REPLACES.
 *
 * That one keyed the dispatch on the target's repo-relative path: the
 * structured scanners ran for a `test/__fixtures__/` path with a `.json` /
 * `.ndjson` / `.xml` suffix, and everything else took the source pass. THE
 * SHARED ENGINE HANDS A DETECTOR THE REPORTED LOCUS, WHICH CARRIES AN ORIGIN
 * LABEL (`… (as git carries it)`) FOR A TARGET READ OUT OF THE INDEX, and no
 * undecorated path. Reconstructing one by stripping the engine's own decoration
 * would be a local copy of an engine-owned format, and it would be wrong in the
 * one direction that matters: a fixture read through the union half would stop
 * matching `.json` and silently fall to the weaker pass. So the decision is
 * taken on the bytes, which every route carries identically.
 *
 * WHAT THAT CHANGES, STATED RATHER THAN LEFT TO BE FOUND. The structured
 * scanners now reach a FHIR document wherever it lives, not only under
 * `test/__fixtures__/`; a JSON file that is not a resource walks to no keyed
 * element and reports nothing. Hand-written source is unaffected: a `.ts` file
 * does not parse as JSON and does not begin with `<`, so it still takes the
 * source pass, which is what keeps a JSDoc `@example` carrying synthetic names
 * out of the structured detectors.
 */
function shapeOf(text: string): Shape {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { kind: "source" };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { kind: "json", doc: JSON.parse(trimmed) };
    } catch {
      // Not one document. It may still be NDJSON, which is checked below; a
      // malformed or fragmentary leaked resource falls through to the source
      // pass, which reads names, dates and address lines out of it.
    }
    const docs: { doc: unknown; line: number }[] = [];
    const lines = text.split(/\r?\n/);
    let ok = true;
    for (let i = 0; i < lines.length && ok; i += 1) {
      const line = (lines[i] ?? "").trim();
      if (line.length === 0) continue;
      try {
        docs.push({ doc: JSON.parse(line), line: i + 1 });
      } catch {
        ok = false;
      }
    }
    if (ok && docs.length > 0) return { kind: "ndjson", docs };
    return { kind: "source" };
  }
  if (trimmed.startsWith("<")) return { kind: "xml" };
  return { kind: "source" };
}

/**
 * THE FHIR-SPECIFIC HALF, folded into the one callback the engine hands the
 * bytes to. Hits are raised through `ctx.hit`, which fills in the locus: the
 * union half scans bytes that may not be the ones on disk, and a hit naming an
 * undecorated path a developer then opens and finds clean is its own defect.
 *
 * @param ctx The target's text and bytes, the parsed allow-list, and `hit`.
 */
function detect(ctx: DetectContext): void {
  const s: Scan = { ctx, dobs: declaredDobs(ctx.allow) };
  const shape = shapeOf(ctx.text);
  switch (shape.kind) {
    case "json":
      walkResource(s, shape.doc, rootLabel(shape.doc));
      break;
    case "ndjson":
      for (const { doc, line } of shape.docs) {
        walkResource(s, doc, `line ${String(line)}: ${rootLabel(doc)}`);
      }
      break;
    case "xml":
      scanXmlText(s, ctx.text);
      break;
    case "source":
      // No structured document to lean on (hand-written source, a malformed or
      // fragmentary resource): the FHIR-keyed literal recogniser, which reads
      // both the object-literal and the XML-attribute spelling. The engine's
      // floor has already run over the same bytes.
      scanSourceLiterals(s, ctx.text);
      break;
  }
}

process.exit(
  runPhiScan({
    exitCodes: EXIT_CODES,
    scanRoots: SCAN_ROOTS,
    excludedPaths: EXCLUDED_PATHS,
    isStagedReadable,
    detect,
    // `isWalkReadable` is deliberately NOT set: the engine's default is the
    // shared Markdown exemption, which is exactly what this repo's own walk and
    // index routes applied. Leaving it unset means that if the boundary ever
    // moves it moves for every repo at once through a version bump.
    //
    // `regularBlobModes` is deliberately NOT set either: this repo used git's
    // two regular-blob modes, which is the engine's default.
  }),
);
