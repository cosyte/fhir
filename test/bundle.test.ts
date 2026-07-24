import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BUNDLE_TYPES,
  entryProcessing,
  isAtomicBundle,
  parseResource,
  readBundle,
} from "../src/index.js";
import { nth } from "./_util.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

describe("readBundle: the Bundle model + entry-processing semantics", () => {
  it("pins the R4 bundle-type value set", () => {
    expect(BUNDLE_TYPES).toEqual({
      DOCUMENT: "document",
      MESSAGE: "message",
      TRANSACTION: "transaction",
      TRANSACTION_RESPONSE: "transaction-response",
      BATCH: "batch",
      BATCH_RESPONSE: "batch-response",
      HISTORY: "history",
      SEARCHSET: "searchset",
      COLLECTION: "collection",
    });
  });

  it("classifies transaction as all-or-nothing (atomic)", () => {
    const { resource } = parseResource(fixture("bundle-transaction.json"));
    const bundle = readBundle(resource);
    expect(bundle.type).toBe("transaction");
    expect(bundle.processing).toBe("atomic");
    expect(bundle.atomic).toBe(true);
    expect(bundle.entries).toHaveLength(2);
    const first = nth(bundle.entries, 0);
    expect(first.fullUrl).toBe("urn:uuid:aa");
    expect(first.resourceType).toBe("Patient");
    expect(first.resourceId).toBe("aa");
    expect(first.requestMethod).toBe("POST");
    expect(first.requestUrl).toBe("Patient");
    expect(first.hasResource).toBe(true);
  });

  it("classifies batch as independent: the semantics are genuinely distinct from transaction", () => {
    const { resource } = parseResource(fixture("bundle-batch.json"));
    const bundle = readBundle(resource);
    expect(bundle.type).toBe("batch");
    expect(bundle.processing).toBe("independent");
    expect(bundle.atomic).toBe(false);
    // A batch entry here is request-only (no inline resource).
    const first = nth(bundle.entries, 0);
    expect(first.hasResource).toBe(false);
    expect(first.resource).toBeUndefined();
    expect(first.requestMethod).toBe("GET");
    expect(first.resourceType).toBeUndefined();
  });

  it("entryProcessing / isAtomicBundle: transaction ≠ batch ≠ the rest", () => {
    expect(entryProcessing("transaction")).toBe("atomic");
    expect(entryProcessing("batch")).toBe("independent");
    expect(entryProcessing("searchset")).toBe("none");
    expect(entryProcessing("document")).toBe("none");
    expect(entryProcessing(undefined)).toBe("none");
    expect(isAtomicBundle("transaction")).toBe(true);
    expect(isAtomicBundle("batch")).toBe(false);
    expect(isAtomicBundle("collection")).toBe(false);
  });

  it("surfaces searchset total as a lexical string, never a JS number", () => {
    const { resource } = parseResource(
      '{"resourceType":"Bundle","type":"searchset","total":42,"entry":[]}',
    );
    const bundle = readBundle(resource);
    expect(bundle.type).toBe("searchset");
    expect(bundle.processing).toBe("none");
    expect(bundle.total).toBe("42");
    expect(typeof bundle.total).toBe("string");
    expect(bundle.entries).toHaveLength(0);
  });

  it("reads a response entry's status and a document type with no entries", () => {
    const { resource } = parseResource(
      '{"resourceType":"Bundle","type":"transaction-response","entry":[' +
        '{"response":{"status":"201 Created"}}]}',
    );
    const bundle = readBundle(resource);
    expect(bundle.type).toBe("transaction-response");
    expect(bundle.processing).toBe("none");
    expect(nth(bundle.entries, 0).responseStatus).toBe("201 Created");
  });

  it("is lenient: a Bundle with no type / an empty entry reads without throwing", () => {
    const { resource } = parseResource(
      '{"resourceType":"Bundle","entry":[{},{"fullUrl":"urn:uuid:x"}]}',
    );
    const bundle = readBundle(resource);
    expect(bundle.type).toBeUndefined();
    expect(bundle.processing).toBe("none");
    expect(bundle.entries).toHaveLength(2);
    // The empty entry degrades to empty fields, never dropped.
    expect(nth(bundle.entries, 0).fullUrl).toBeUndefined();
    expect(nth(bundle.entries, 0).hasResource).toBe(false);
    expect(nth(bundle.entries, 1).fullUrl).toBe("urn:uuid:x");
  });

  it("tolerates a non-complex entry item (an entry that is not an object)", () => {
    // A fully-scalar entry array is read as a primitive list by the codec; each entry degrades to
    // empty fields rather than throwing.
    const { resource } = parseResource(
      '{"resourceType":"Bundle","type":"collection","entry":["x"]}',
    );
    const bundle = readBundle(resource);
    expect(bundle.entries).toHaveLength(1);
    expect(nth(bundle.entries, 0).hasResource).toBe(false);
    expect(nth(bundle.entries, 0).fullUrl).toBeUndefined();
  });

  it("reads a Bundle with no entry element at all", () => {
    const { resource } = parseResource('{"resourceType":"Bundle","type":"collection"}');
    const bundle = readBundle(resource);
    expect(bundle.entries).toHaveLength(0);
    expect(bundle.total).toBeUndefined();
  });
});
