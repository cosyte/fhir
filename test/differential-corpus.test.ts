/**
 * The differential corpus declaration: the floor, the per-document provenance, the digest refusal,
 * and the licence obligations that travel with third-party content.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * NO JVM, NO NETWORK, NO BUILD
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * Everything here runs against `scripts/differential/corpus.mjs`, which imports no `dist/`, spawns
 * nothing and reaches no URL. That is the whole point: the counting, the exclusion accounting and
 * the fail-closed paths are gradeable in a container with no Java, which is where this suite runs.
 * The oracle half of the gate is CI-only and is graded there.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE. Nothing in this file asserts that the documents are ON
 * DISK. They are fetched (`pnpm corpus:fetch`) into the git-ignored `corpus/documents/`, so a clean
 * checkout has the declaration and not the bytes, and a suite that demanded the bytes would be red
 * on every fresh clone. What IS asserted is that the harness REFUSES when a declared document is
 * missing, unreadable or the wrong bytes, which is the property the criterion is about.
 */

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CorpusError,
  corpusOf,
  DECLARATION_PATH,
  declaredDocuments,
  determinismSubset,
  documentLocation,
  exclusions,
  includedDocuments,
  loadDeclaration,
  LICENCES_ROOT,
  parseDeclaration,
  readDeclaredDocument,
  REPO_ROOT,
  resolveCorpus,
  sha256,
  shortfall,
} from "../scripts/differential/corpus.mjs";
import type { Declaration, DocumentRecord } from "../scripts/differential/corpus.mjs";
import { extractNamed, readCentralDirectory, ZipError } from "../scripts/differential/zip.mjs";

const declaration = loadDeclaration();

/** A throwaway document root, so the refusal paths are exercised on real files. */
function scratchCorpus(): { root: string; write: (rel: string, body: string) => void } {
  const root = mkdtempSync(join(tmpdir(), "fhir-corpus-test-"));
  return {
    root,
    write(rel, body) {
      const file = join(root, rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body);
    },
  };
}

function scratchDeclaration(overrides: Partial<DocumentRecord> = {}): {
  declaration: Declaration;
  document: DocumentRecord;
} {
  const body = '{"resourceType":"Patient","id":"x"}';
  const document: DocumentRecord = {
    id: "scratch/one.json",
    corpus: "scratch",
    path: "one.json",
    bytes: Buffer.byteLength(body),
    sha256: sha256(Buffer.from(body)),
    ...overrides,
  };
  const decl = parseDeclaration(
    JSON.stringify({
      schemaVersion: 1,
      comparedFloor: 1,
      corpora: [
        {
          id: "scratch",
          title: "scratch",
          version: "0",
          licence: "CC0-1.0",
          origin: "https://example.org/",
          authored: "third-party",
          acquisition: { kind: "files", baseUrl: "https://example.org/" },
          licenceText: "licences/x.txt",
          notice: "licences/x-NOTICE.txt",
        },
      ],
      documents: [document],
    }),
  );
  return { declaration: decl, document };
}

describe("the declared corpus clears the floor, and the floor is what the run exits on", () => {
  it("declares at least one hundred documents to compare", () => {
    // "WHEN the differential job runs THE SYSTEM SHALL compare at least one hundred documents"
    expect(declaration.comparedFloor).toBeGreaterThanOrEqual(100);
    expect(includedDocuments(declaration).length).toBeGreaterThanOrEqual(declaration.comparedFloor);
  });

  it("clears the floor on THIRD-PARTY documents alone, so the number is not made of our own fixtures", () => {
    const thirdParty = includedDocuments(declaration).filter(
      (d) => corpusOf(declaration, d).authored === "third-party",
    );
    expect(thirdParty.length).toBeGreaterThanOrEqual(100);
  });

  it("names the shortfall rather than reporting success over a smaller corpus", () => {
    // "IF fewer than one hundred documents were compared THEN ... exit non-zero and name the shortfall"
    const message = shortfall(99, 100);
    expect(message).not.toBeNull();
    expect(message).toContain("99");
    expect(message).toContain("100");
    expect(message).toContain("Short by 1");
    expect(shortfall(100, 100)).toBeNull();
    expect(shortfall(101, 100)).toBeNull();
  });

  it("does not count an excluded document toward the floor", () => {
    const excluded = exclusions(declaration).map((e) => e.id);
    const included = includedDocuments(declaration).map((d) => d.id);
    for (const id of excluded) expect(included).not.toContain(id);
    expect(included.length + excluded.length).toBe(declaredDocuments(declaration).length);
  });

  it("records a REASON, not a label, for every exclusion", () => {
    for (const entry of exclusions(declaration)) {
      expect(entry.reason.length, `${entry.id} must record why`).toBeGreaterThan(40);
    }
  });
});

describe("determinism was not bought by comparing less", () => {
  /**
   * The compared count as of the corpus this declaration was written against. It is a FLOOR on the
   * declaration, not a target: it may rise, and it may not fall. Held here rather than in prose
   * because a count in a docblock does not red anything when someone quietly excludes a document to
   * make a gate green.
   */
  const COMPARED_AT_LEAST = 173;

  it("declares at least as many documents for comparison as it did before", () => {
    // "WHEN the corpus declaration is loaded after this change, THE SYSTEM SHALL declare at least
    // 173 documents for comparison and SHALL still meet the declared compared floor, so that no
    // document is excluded in order to obtain determinism."
    expect(includedDocuments(declaration).length).toBeGreaterThanOrEqual(COMPARED_AT_LEAST);
    expect(includedDocuments(declaration).length).toBeGreaterThanOrEqual(declaration.comparedFloor);
    expect(declaration.comparedFloor).toBeGreaterThanOrEqual(100);
  });

  it("returned the exclusions whose measured reason was ONLY a terminology finding", () => {
    // Those six were held out because the reference validator reported `code-invalid`, which it
    // emits when it checks a code against terminology content this library declaredly does not
    // vendor. That is now a recorded class rather than a snapshot of one date's answers, so the
    // documents are compared.
    const returned = [
      "hl7-fhir-r4-examples/chargeitem-example.json",
      "hl7-fhir-r4-examples/contract-example-ins-policy.json",
      "hl7-fhir-r4-examples/contract-example.json",
      "hl7-fhir-r4-examples/imagingstudy-example-xr.json",
      "hl7-fhir-r4-examples/immunizationevaluation-example-notvalid.json",
      "hl7-fhir-r4-examples/visionprescription-example-1.json",
    ];
    const included = new Set(includedDocuments(declaration).map((d) => d.id));
    const excluded = new Set(exclusions(declaration).map((e) => e.id));
    for (const id of returned) {
      expect(included.has(id), `${id} must be compared`).toBe(true);
      expect(excluded.has(id), `${id} must not be excluded`).toBe(false);
      const document = declaredDocuments(declaration).find((d) => d.id === id);
      // The declaration records WHY it came back, the same way an exclusion records why it left.
      expect(String(document?.note)).toContain("returned to the compared set");
    }
  });

  it("keeps every exclusion whose measured reason is NOT only a terminology finding", () => {
    // An exclusion that names a non-terminology class stays an exclusion: this change replaces a
    // snapshot with a rule for ONE class, and does not clear anything else.
    for (const entry of exclusions(declaration)) {
      const classes = new Set<string>();
      for (const match of entry.reason.matchAll(/\dx ([a-z-]+) \(/g)) classes.add(match[1] ?? "");
      const terminologyOnly = classes.size === 1 && classes.has("code-invalid");
      expect(terminologyOnly, `${entry.id} is excluded for a terminology finding alone`).toBe(
        false,
      );
    }
  });

  it("declares the subset the determinism check repeats, rather than sampling one per run", () => {
    const subset = determinismSubset(declaration);
    expect(subset.length).toBeGreaterThan(0);
    // A subset spanning all three corpora, so it is not a repeat of our own fixtures alone.
    expect(new Set(subset.map((d) => d.corpus)).size).toBe(declaration.corpora.length);
    // Every repeated document is one the differential compares.
    const included = new Set(includedDocuments(declaration).map((d) => d.id));
    for (const document of subset) expect(included.has(document.id)).toBe(true);
    // It fits inside the differential job's declared time bound: a small multiple of one batch.
    expect(subset.length).toBeLessThanOrEqual(40);
  });

  it("refuses a determinism subset that names a document the differential does not compare", () => {
    const base = JSON.parse(readFileSync(DECLARATION_PATH, "utf8")) as {
      determinismSubset: string[];
      documents: { id: string; exclude?: string }[];
    };
    const excludedId = base.documents.find((d) => d.exclude !== undefined)?.id;
    expect(excludedId).toBeDefined();
    expect(() =>
      parseDeclaration(JSON.stringify({ ...base, determinismSubset: [String(excludedId)] })),
    ).toThrow(/may only repeat documents the differential compares/);
    expect(() =>
      parseDeclaration(JSON.stringify({ ...base, determinismSubset: ["nothing/at-all.json"] })),
    ).toThrow(CorpusError);
    expect(() => parseDeclaration(JSON.stringify({ ...base, determinismSubset: [] }))).toThrow(
      /non-empty array/,
    );
    const first = String(base.determinismSubset[0]);
    expect(() =>
      parseDeclaration(JSON.stringify({ ...base, determinismSubset: [first, first] })),
    ).toThrow(/duplicate determinismSubset id/);
  });

  it("refuses to repeat anything when no subset is declared, rather than repeating everything", () => {
    const { declaration: decl } = scratchDeclaration();
    expect(() => determinismSubset(decl)).toThrow(/declares no determinismSubset/);
  });
});

describe("provenance: every declared document names its corpus, that corpus's version and licence", () => {
  it("resolves every document to a corpus carrying all three facts", () => {
    // "WHEN the corpus declares a document THE SYSTEM SHALL record which public corpus it came
    // from, that corpus's exact pinned version, and that corpus's licence identifier"
    for (const document of declaredDocuments(declaration)) {
      const corpus = corpusOf(declaration, document);
      expect(corpus.version.length, `${document.id} version`).toBeGreaterThan(0);
      expect(corpus.licence, `${document.id} licence`).toMatch(/^[A-Za-z0-9.\-+]+$/);
      expect(corpus.origin, `${document.id} origin`).toMatch(/^https:\/\//);
    }
  });

  it("pins each third-party corpus to an exact version, never a moving pointer", () => {
    for (const corpus of declaration.corpora) {
      if (corpus.authored !== "third-party") continue;
      expect(corpus.version).not.toMatch(/latest|main|master|HEAD/i);
      if (corpus.acquisition.kind === "files") {
        // A raw base URL pinned to a commit, not to a branch.
        expect(corpus.acquisition.baseUrl).toMatch(/[0-9a-f]{40}/);
      }
      if (corpus.acquisition.kind === "archive") {
        expect(corpus.acquisition.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it("uses more than one public corpus, and one of them is not the other's licence", () => {
    const thirdParty = declaration.corpora.filter((c) => c.authored === "third-party");
    expect(thirdParty.length).toBeGreaterThanOrEqual(2);
    expect(new Set(thirdParty.map((c) => c.licence)).size).toBeGreaterThanOrEqual(2);
  });

  it("gives every document a unique id and a relative path that cannot climb", () => {
    const ids = new Set<string>();
    for (const document of declaredDocuments(declaration)) {
      expect(ids.has(document.id)).toBe(false);
      ids.add(document.id);
      expect(document.path.split("/")).not.toContain("..");
    }
  });
});

describe("licence text and attribution travel with third-party content", () => {
  it("carries a licence text and a notice beside every third-party corpus it names", () => {
    // "IF third-party corpus content is committed into this repository THEN ... carry that corpus's
    // licence text and its required attribution beside the content". The documents are FETCHED
    // rather than committed, which makes the antecedent false; the obligation is honoured anyway,
    // because `pnpm corpus:fetch` obtains licensed material through this repository's own tooling.
    for (const corpus of declaration.corpora) {
      if (corpus.authored !== "third-party") continue;
      const licence = readFileSync(join(LICENCES_ROOT, String(corpus.licenceText)), "utf8");
      const notice = readFileSync(join(LICENCES_ROOT, String(corpus.notice)), "utf8");
      expect(licence.length).toBeGreaterThan(1000);
      expect(notice).toContain(corpus.version.split(" ")[0] ?? corpus.version);
      expect(notice).toContain(corpus.licence);
    }
  });

  it("names the Apache-2.0 corpus's own licence text, not a paraphrase of it", () => {
    const apache = declaration.corpora.find((c) => c.licence === "Apache-2.0");
    expect(apache).toBeDefined();
    const text = readFileSync(join(LICENCES_ROOT, String(apache?.licenceText)), "utf8");
    expect(text).toContain("Apache License");
    expect(text).toContain("Version 2.0, January 2004");
  });

  it("names the CC0 corpus's own legal code and records the trademark HL7 reserves separately", () => {
    const cc0 = declaration.corpora.find((c) => c.licence === "CC0-1.0");
    expect(cc0).toBeDefined();
    const text = readFileSync(join(LICENCES_ROOT, String(cc0?.licenceText)), "utf8");
    expect(text).toContain("CC0 1.0 Universal");
    const notice = readFileSync(join(LICENCES_ROOT, String(cc0?.notice)), "utf8");
    expect(notice).toContain("trademark");
  });

  it("commits no third-party document content: every fetched corpus lands outside the tree", () => {
    for (const document of declaredDocuments(declaration)) {
      const corpus = corpusOf(declaration, document);
      if (corpus.acquisition.kind === "in-tree") continue;
      expect(documentLocation(declaration, document)).toContain(join("corpus", "documents"));
    }
    const ignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
    expect(ignore).toContain("corpus/documents/");
  });
});

describe("a document that is missing, unreadable or the wrong bytes fails the run", () => {
  it("refuses a declared document that is not there", () => {
    const { declaration: decl, document } = scratchDeclaration();
    const { root } = scratchCorpus();
    expect(() => readDeclaredDocument(decl, document, { documentsRoot: root })).toThrow(
      CorpusError,
    );
    expect(() => readDeclaredDocument(decl, document, { documentsRoot: root })).toThrow(
      /not readable/,
    );
  });

  it("refuses a declared document whose digest does not match", () => {
    const { declaration: decl, document } = scratchDeclaration();
    const { root, write } = scratchCorpus();
    write("scratch/one.json", '{"resourceType":"Patient","id":"y"}');
    expect(() => readDeclaredDocument(decl, document, { documentsRoot: root })).toThrow(
      /digest mismatch/,
    );
  });

  it("refuses a declared document whose length does not match", () => {
    const { declaration: decl, document } = scratchDeclaration();
    const { root, write } = scratchCorpus();
    write("scratch/one.json", '{"resourceType":"Patient"}');
    expect(() => readDeclaredDocument(decl, document, { documentsRoot: root })).toThrow(
      /declared \d+ bytes/,
    );
  });

  it("accepts the declared bytes and hands back the text", () => {
    const { declaration: decl, document } = scratchDeclaration();
    const { root, write } = scratchCorpus();
    write("scratch/one.json", '{"resourceType":"Patient","id":"x"}');
    const resolved = readDeclaredDocument(decl, document, { documentsRoot: root });
    expect(resolved.text).toContain("Patient");
    expect(resolved.document.id).toBe("scratch/one.json");
  });

  it("verifies an EXCLUDED document too: the declaration declares it, so its absence is a refusal", () => {
    const { declaration: decl } = scratchDeclaration({
      exclude:
        "declared as a negative case and deliberately not compared, recorded here so the corpus " +
        "cannot shrink in silence",
    });
    const { root } = scratchCorpus();
    expect(() => resolveCorpus(decl, { documentsRoot: root })).toThrow(CorpusError);
  });

  it("narrowing to a subset narrows what is HANDED BACK, never what is VERIFIED", () => {
    // "IF a declared corpus document is missing, unreadable, or its bytes do not match the digest
    // recorded for it, THEN THE SYSTEM SHALL refuse the run ... and this refusal SHALL remain
    // exactly as strict as it is today." The determinism check compares a declared subset twice; a
    // subset run that stopped digest-checking the rest would be the same corpus shrinking in
    // silence, one indirection away.
    const bodyOne = '{"resourceType":"Patient","id":"x"}';
    const bodyTwo = '{"resourceType":"Patient","id":"y"}';
    const decl = parseDeclaration(
      JSON.stringify({
        schemaVersion: 1,
        comparedFloor: 1,
        corpora: [
          {
            id: "scratch",
            title: "scratch",
            version: "0",
            licence: "CC0-1.0",
            origin: "https://example.org/",
            authored: "third-party",
            acquisition: { kind: "files", baseUrl: "https://example.org/" },
            licenceText: "licences/x.txt",
            notice: "licences/x-NOTICE.txt",
          },
        ],
        documents: [
          {
            id: "scratch/one.json",
            corpus: "scratch",
            path: "one.json",
            bytes: Buffer.byteLength(bodyOne),
            sha256: sha256(Buffer.from(bodyOne)),
          },
          {
            id: "scratch/two.json",
            corpus: "scratch",
            path: "two.json",
            bytes: Buffer.byteLength(bodyTwo),
            sha256: sha256(Buffer.from(bodyTwo)),
          },
        ],
      }),
    );
    const { root, write } = scratchCorpus();
    write("scratch/one.json", bodyOne);
    // The document OUTSIDE the subset is the wrong bytes, and the subset run still refuses.
    write("scratch/two.json", '{"resourceType":"Patient","id":"tampered"}');
    expect(() => resolveCorpus(decl, { documentsRoot: root, only: ["scratch/one.json"] })).toThrow(
      /scratch\/two\.json/,
    );
    write("scratch/two.json", bodyTwo);
    const resolved = resolveCorpus(decl, { documentsRoot: root, only: ["scratch/one.json"] });
    expect(resolved.map((r) => r.document.id)).toEqual(["scratch/one.json"]);
  });
});

describe("a declaration that cannot be trusted is refused rather than partly used", () => {
  it("refuses JSON that does not parse", () => {
    expect(() => parseDeclaration("{ not json")).toThrow(CorpusError);
  });

  it("refuses an unsupported schema version", () => {
    expect(() => parseDeclaration(JSON.stringify({ schemaVersion: 2 }))).toThrow(/schemaVersion/);
  });

  it("refuses a document whose corpus is not declared", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      comparedFloor: 1,
      corpora: [
        {
          id: "a",
          title: "a",
          version: "1",
          licence: "MIT",
          origin: "https://example.org/",
          authored: "self",
          acquisition: { kind: "in-tree", root: "test/__fixtures__" },
          licenceText: null,
          notice: null,
        },
      ],
      documents: [{ id: "b/x", corpus: "b", path: "x.json", bytes: 1, sha256: "0".repeat(64) }],
    });
    expect(() => parseDeclaration(text)).toThrow(/names no declared corpus/);
  });

  it("refuses an exclusion that is a label rather than a reason", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      comparedFloor: 1,
      corpora: [
        {
          id: "a",
          title: "a",
          version: "1",
          licence: "MIT",
          origin: "https://example.org/",
          authored: "self",
          acquisition: { kind: "in-tree", root: "test/__fixtures__" },
          licenceText: null,
          notice: null,
        },
      ],
      documents: [
        {
          id: "a/x",
          corpus: "a",
          path: "x.json",
          bytes: 1,
          sha256: "0".repeat(64),
          exclude: "flaky",
        },
      ],
    });
    expect(() => parseDeclaration(text)).toThrow(/must record WHY/);
  });

  it("refuses a document path that climbs out of its corpus", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      comparedFloor: 1,
      corpora: [
        {
          id: "a",
          title: "a",
          version: "1",
          licence: "MIT",
          origin: "https://example.org/",
          authored: "self",
          acquisition: { kind: "in-tree", root: "test/__fixtures__" },
          licenceText: null,
          notice: null,
        },
      ],
      documents: [
        { id: "a/x", corpus: "a", path: "../../src/index.ts", bytes: 1, sha256: "0".repeat(64) },
      ],
    });
    expect(() => parseDeclaration(text)).toThrow(/does not climb/);
  });

  it("refuses a third-party corpus that carries no licence text", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      comparedFloor: 1,
      corpora: [
        {
          id: "a",
          title: "a",
          version: "1",
          licence: "Apache-2.0",
          origin: "https://example.org/",
          authored: "third-party",
          acquisition: { kind: "files", baseUrl: "https://example.org/" },
          licenceText: null,
          notice: null,
        },
      ],
      documents: [{ id: "a/x", corpus: "a", path: "x.json", bytes: 1, sha256: "0".repeat(64) }],
    });
    expect(() => parseDeclaration(text)).toThrow(/licenceText/);
  });

  it("refuses a declaration file that is not there at all", () => {
    expect(() => loadDeclaration(join(REPO_ROOT, "corpus", "no-such-declaration.json"))).toThrow(
      CorpusError,
    );
  });
});

describe("the committed declaration is the one the harness loads", () => {
  it("loads from corpus/corpus.json and is prettier-stable JSON", () => {
    expect(DECLARATION_PATH).toContain(join("corpus", "corpus.json"));
    const text = readFileSync(DECLARATION_PATH, "utf8");
    expect(`${JSON.stringify(JSON.parse(text), null, 2)}\n`).toBe(text);
  });

  it("keeps this repository's own fixtures in the corpus, quirk tier included", () => {
    const ours = declaredDocuments(declaration).filter(
      (d) => corpusOf(declaration, d).authored === "self",
    );
    const names = ours.map((d) => d.path);
    expect(names).toContain("quirk-primitive-extension-misaligned.json");
    expect(names).toContain("patient.json");
    // The in-tree fixtures are read from the checkout, so these ARE verifiable here.
    for (const document of ours) {
      const resolved = readDeclaredDocument(declaration, document);
      expect(resolved.bytes.length).toBe(document.bytes);
    }
  });
});

describe("the archive reader the CC0 corpus is materialised through", () => {
  function buildZip(entries: readonly { name: string; body: Buffer }[]): Buffer {
    // A stored-method zip, written by hand so the reader is graded against bytes this test owns.
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
      const name = Buffer.from(entry.name, "utf8");
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0, 8); // stored
      local.writeUInt32LE(entry.body.length, 18);
      local.writeUInt32LE(entry.body.length, 22);
      local.writeUInt16LE(name.length, 26);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(0, 10);
      central.writeUInt32LE(entry.body.length, 20);
      central.writeUInt32LE(entry.body.length, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt32LE(offset, 42);
      locals.push(local, name, entry.body);
      centrals.push(central, name);
      offset += local.length + name.length + entry.body.length;
    }
    const centralBytes = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBytes.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, centralBytes, eocd]);
  }

  it("reads the central directory and extracts exactly the named entries", () => {
    const zip = buildZip([
      { name: "a.json", body: Buffer.from('{"resourceType":"Patient"}') },
      { name: "xa.json", body: Buffer.from('{"resourceType":"Observation"}') },
    ]);
    expect(readCentralDirectory(zip).map((e) => e.name)).toEqual(["a.json", "xa.json"]);
    const got = extractNamed(zip, ["a.json"]);
    expect(got.size).toBe(1);
    expect(got.get("a.json")?.toString("utf8")).toContain("Patient");
  });

  it("refuses an archive that does not carry a declared entry, rather than returning a short list", () => {
    const zip = buildZip([{ name: "a.json", body: Buffer.from("{}") }]);
    expect(() => extractNamed(zip, ["b.json"])).toThrow(ZipError);
  });

  it("refuses bytes that are not a zip archive at all", () => {
    expect(() => readCentralDirectory(Buffer.alloc(64))).toThrow(ZipError);
  });
});
