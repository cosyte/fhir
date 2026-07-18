/**
 * The `Bundle` model and its **entry-processing semantics** (Phase 9, bundle.html).
 *
 * A FHIR `Bundle` is a container for a list of resources, tagged by a `type` that fixes what the
 * container *means*. This module reads a Bundle into an explicit, value-free {@link BundleReadout}
 * and — crucially — classifies the one semantic distinction that a consumer must never blur:
 *
 * - **`transaction` is all-or-nothing.** Every entry is applied as a single atomic unit: either all
 *   succeed or the whole Bundle is rolled back, and entries may be interdependent (a POST that another
 *   entry references). {@link entryProcessing} returns `"atomic"`.
 * - **`batch` is independent.** Each entry is applied on its own; one entry failing does **not** roll
 *   back the others, and entries must not depend on each other. {@link entryProcessing} returns
 *   `"independent"`.
 *
 * Every other type (`document`, `message`, `searchset`, `collection`, `history`, and the server-reply
 * `*-response` variants) is not a processing request, so it carries **no** entry-processing contract:
 * {@link entryProcessing} returns `"none"`.
 *
 * **Non-goal (stated, not built).** This library models the Bundle *artifact* and its semantics. It
 * does **not** execute a transaction or a batch — there is no server here, nothing is applied, nothing
 * is rolled back. `entryProcessing` tells a caller *how a server would treat the entries*; honoring
 * that contract is the server's job (or `pathways`'), not this library's.
 *
 * @packageDocumentation
 */

import { getProperty, isComplex, isList, isPrimitive } from "../model/index.js";
import type { FhirComplex, FhirNode } from "../model/index.js";

/**
 * The R4 `Bundle.type` value set (`valueset-bundle-type`), in full. The seven Phase-9 headline types
 * plus the two server-reply variants a real feed carries, so an incoming `transaction-response` /
 * `batch-response` classifies rather than falling through. Frozen via `as const`.
 */
export const BUNDLE_TYPES = {
  /** A fully-formed clinical document (first entry is a `Composition`). */
  DOCUMENT: "document",
  /** A message (first entry is a `MessageHeader`). */
  MESSAGE: "message",
  /** A set of actions applied **atomically** — all-or-nothing. */
  TRANSACTION: "transaction",
  /** The server's reply to a `transaction`. */
  TRANSACTION_RESPONSE: "transaction-response",
  /** A set of actions applied **independently** — one failing does not roll back the rest. */
  BATCH: "batch",
  /** The server's reply to a `batch`. */
  BATCH_RESPONSE: "batch-response",
  /** A list of prior versions of one or more resources. */
  HISTORY: "history",
  /** The result set of a search. */
  SEARCHSET: "searchset",
  /** An arbitrary collection with no processing semantics. */
  COLLECTION: "collection",
} as const;

/** One of the {@link BUNDLE_TYPES} — the R4 `Bundle.type`. */
export type BundleType = (typeof BUNDLE_TYPES)[keyof typeof BUNDLE_TYPES];

/**
 * How a server would process a Bundle's entries — the artifact-level semantic contract.
 *
 * - `"atomic"` — a `transaction`: all-or-nothing, entries may be interdependent.
 * - `"independent"` — a `batch`: each entry on its own, no rollback across entries.
 * - `"none"` — every other type: not a processing request, no entry contract.
 */
export type EntryProcessing = "atomic" | "independent" | "none";

/**
 * The entry-processing semantics for a `Bundle.type` (bundle.html). This is the all-or-nothing
 * (`transaction`) vs independent (`batch`) distinction, modeled explicitly so a caller never has to
 * re-derive it — and never conflates the two.
 *
 * @param type - The `Bundle.type` code (or any string; unknown types are `"none"`).
 * @returns `"atomic"` for `transaction`, `"independent"` for `batch`, `"none"` otherwise.
 * @example
 * ```ts
 * import { entryProcessing } from "@cosyte/fhir";
 * entryProcessing("transaction"); // "atomic"      — all-or-nothing
 * entryProcessing("batch");       // "independent" — entries stand alone
 * entryProcessing("searchset");   // "none"        — not a processing request
 * ```
 */
export function entryProcessing(type: string | undefined): EntryProcessing {
  if (type === BUNDLE_TYPES.TRANSACTION) return "atomic";
  if (type === BUNDLE_TYPES.BATCH) return "independent";
  return "none";
}

/**
 * Whether a `Bundle.type` is applied **all-or-nothing** (a `transaction`). The inverse of "entries are
 * independent"; a convenience over {@link entryProcessing}.
 *
 * @example
 * ```ts
 * import { isAtomicBundle } from "@cosyte/fhir";
 * isAtomicBundle("transaction"); // true
 * isAtomicBundle("batch");       // false
 * ```
 */
export function isAtomicBundle(type: string | undefined): boolean {
  return entryProcessing(type) === "atomic";
}

/**
 * One entry of a {@link BundleReadout} — value-free, structural facts only.
 *
 * `request`/`response` presence and the request method/url are surfaced (a `transaction`/`batch`
 * entry carries a `request`; a `*-response` entry carries a `response`) so a caller can see the
 * *shape* of the entry without this library interpreting or executing it.
 */
export interface BundleEntry {
  /** Zero-based position of the entry in `Bundle.entry`. */
  readonly index: number;
  /** The entry `fullUrl`, when present — the identity a reference resolves against. */
  readonly fullUrl: string | undefined;
  /** Whether the entry carries an inline `resource`. */
  readonly hasResource: boolean;
  /** The wrapped resource's `resourceType`, when it has one. */
  readonly resourceType: string | undefined;
  /** The wrapped resource's logical `id`, when it has one. */
  readonly resourceId: string | undefined;
  /** The wrapped resource itself, for downstream reference resolution. `undefined` when absent. */
  readonly resource: FhirComplex | undefined;
  /** `entry.request.method` (`GET`/`POST`/`PUT`/`DELETE`/`PATCH`/`HEAD`), when present. */
  readonly requestMethod: string | undefined;
  /** `entry.request.url`, when present. */
  readonly requestUrl: string | undefined;
  /** `entry.response.status`, when present (a server-reply entry). */
  readonly responseStatus: string | undefined;
}

/**
 * The complete, value-free readout of a `Bundle`: its type, the entry-processing semantics implied by
 * that type, and one {@link BundleEntry} per `Bundle.entry` in order.
 *
 * `atomic` restates {@link entryProcessing} `=== "atomic"` for ergonomics: **`true` means the entries
 * are all-or-nothing (a `transaction`)**, `false` means they are independent or the type carries no
 * processing contract. Nothing here is executed — see the module doc.
 */
export interface BundleReadout {
  /** `Bundle.type`, or `undefined` if absent. */
  readonly type: string | undefined;
  /** The entry-processing semantics for {@link type}. */
  readonly processing: EntryProcessing;
  /** `true` exactly for a `transaction` (all-or-nothing); `false` for `batch` and everything else. */
  readonly atomic: boolean;
  /** `Bundle.total` (a `searchset` count), kept as its **lexical string** — never a JS `number`. */
  readonly total: string | undefined;
  /** The entries, in document order. */
  readonly entries: readonly BundleEntry[];
}

/** Read a primitive node's value as its lexical string (a `FhirDecimal` renders precision-exactly). */
function lexicalOf(node: FhirNode | undefined): string | undefined {
  if (node === undefined || !isPrimitive(node) || node.value === undefined) return undefined;
  return typeof node.value === "string" ? node.value : String(node.value);
}

/** The `resourceType` string of a complex node, when it carries one. */
function typeOf(node: FhirComplex): string | undefined {
  return lexicalOf(getProperty(node, "resourceType"));
}

/** Read one `Bundle.entry` complex node into a {@link BundleEntry}. */
function readEntry(entryNode: FhirNode, index: number): BundleEntry {
  if (!isComplex(entryNode)) {
    return {
      index,
      fullUrl: undefined,
      hasResource: false,
      resourceType: undefined,
      resourceId: undefined,
      resource: undefined,
      requestMethod: undefined,
      requestUrl: undefined,
      responseStatus: undefined,
    };
  }
  const resourceNode = getProperty(entryNode, "resource");
  const resource = resourceNode !== undefined && isComplex(resourceNode) ? resourceNode : undefined;
  const requestNode = getProperty(entryNode, "request");
  const request = requestNode !== undefined && isComplex(requestNode) ? requestNode : undefined;
  const responseNode = getProperty(entryNode, "response");
  const response = responseNode !== undefined && isComplex(responseNode) ? responseNode : undefined;
  return {
    index,
    fullUrl: lexicalOf(getProperty(entryNode, "fullUrl")),
    hasResource: resource !== undefined,
    resourceType: resource === undefined ? undefined : typeOf(resource),
    resourceId: resource === undefined ? undefined : lexicalOf(getProperty(resource, "id")),
    resource,
    requestMethod: request === undefined ? undefined : lexicalOf(getProperty(request, "method")),
    requestUrl: request === undefined ? undefined : lexicalOf(getProperty(request, "url")),
    responseStatus: response === undefined ? undefined : lexicalOf(getProperty(response, "status")),
  };
}

/**
 * Read a `Bundle` resource into a value-free {@link BundleReadout} — its type, entry-processing
 * semantics, and one entry per `Bundle.entry`. Lenient: a Bundle with no `type` reads with
 * `type: undefined` / `processing: "none"`, and a malformed entry reads with empty fields rather than
 * throwing (Postel's Law — nothing is dropped, the shape is surfaced).
 *
 * @param bundle - A `Bundle` resource model (typically from `parseResource`).
 * @returns The {@link BundleReadout}. Nothing is executed — see the module doc.
 * @example
 * ```ts
 * import { parseResource, readBundle } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"Bundle","type":"transaction","entry":[' +
 *     '{"fullUrl":"urn:uuid:1","resource":{"resourceType":"Patient","id":"1"},' +
 *     '"request":{"method":"POST","url":"Patient"}}]}',
 * );
 * const bundle = readBundle(resource);
 * bundle.atomic;                 // true — a transaction is all-or-nothing
 * bundle.entries[0]?.fullUrl;    // "urn:uuid:1"
 * bundle.entries[0]?.requestMethod; // "POST"
 * ```
 */
export function readBundle(bundle: FhirComplex): BundleReadout {
  const type = lexicalOf(getProperty(bundle, "type"));
  const entryNode = getProperty(bundle, "entry");
  const entryItems = entryNode !== undefined && isList(entryNode) ? entryNode.items : [];
  const entries = entryItems.map((item, index) => readEntry(item, index));
  return {
    type,
    processing: entryProcessing(type),
    atomic: isAtomicBundle(type),
    total: lexicalOf(getProperty(bundle, "total")),
    entries,
  };
}
