/**
 * `Reference` string classification — the read side of FHIR references.
 *
 * A FHIR `Reference.reference` string comes in four shapes (references.html), and confusing them is
 * a correctness hazard: a fragment points *inside* the same resource, a relative reference names a
 * resource on the same server, an absolute reference names one anywhere, and a logical reference
 * (a `urn:` or a bare token) is not a resolvable RESTful URL at all. This module classifies the
 * string and pulls out the resource type / id / version when they are present — it does **not**
 * resolve the reference (following a reference to its target, cycle-guarded, is Phase 9).
 *
 * @packageDocumentation
 */

/** Which of the four FHIR reference forms a `Reference.reference` string is. */
export type ReferenceKind = "fragment" | "relative" | "absolute" | "logical";

/**
 * A parsed `Reference.reference` string.
 *
 * `type`, `id`, and `version` are populated only when the form makes them unambiguous (a relative
 * reference always; an absolute RESTful URL when its tail matches `Type/id`). A `logical` reference
 * (e.g. `urn:uuid:…`) exposes only `raw` and `kind`.
 */
export interface ParsedReference {
  /** The exact reference string as supplied. */
  readonly raw: string;
  /** The classified form. */
  readonly kind: ReferenceKind;
  /** The referenced resource type, when the form reveals it (e.g. `"Patient"`). */
  readonly type?: string;
  /** The referenced logical id, when the form reveals it. For a fragment this is the anchor. */
  readonly id?: string;
  /** The version id from a `/_history/{vid}` suffix, when present. */
  readonly version?: string;
}

/** A resource-type token followed by an id, optionally with a `/_history/{vid}` version suffix. */
const RELATIVE =
  /^([A-Za-z][A-Za-z0-9]*)\/([A-Za-z0-9\-.]{1,64})(?:\/_history\/([A-Za-z0-9\-.]{1,64}))?$/;

/**
 * Pull `{ type, id, version }` out of the tail of a path when it ends in `Type/id[/_history/vid]`.
 * Returns `undefined` when the tail does not match, so an absolute URL that does not end in a
 * RESTful resource path is still classified `absolute` but without a type/id.
 *
 * @internal
 */
function matchResourcePath(
  path: string,
): { type: string; id: string; version?: string } | undefined {
  const match = RELATIVE.exec(path);
  if (match === null) return undefined;
  const [, type, id, version] = match;
  if (type === undefined || id === undefined) return undefined;
  return version === undefined ? { type, id } : { type, id, version };
}

/**
 * Classify a `Reference.reference` string into its FHIR form and extract the resource
 * type / id / version where the form allows.
 *
 * @param raw - The reference string, e.g. `"Patient/123"`, `"#p1"`, `"https://ehr/fhir/Observation/9/_history/2"`,
 *   `"urn:uuid:…"`.
 * @example
 * ```ts
 * import { parseReference } from "@cosyte/fhir";
 * parseReference("Patient/123");   // { kind: "relative", type: "Patient", id: "123", ... }
 * parseReference("#p1");           // { kind: "fragment", id: "p1", ... }
 * parseReference("urn:uuid:1-2-3"); // { kind: "logical", ... }
 * ```
 */
export function parseReference(raw: string): ParsedReference {
  // Fragment: an internal reference to a contained resource (references.html §"Contained").
  if (raw.startsWith("#")) {
    return { raw, kind: "fragment", id: raw.slice(1) };
  }

  // Absolute URL (has a scheme with `://`). A `urn:` is a URI but not a resolvable RESTful URL, so
  // it is a logical reference, not absolute.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)) {
    const parts = matchResourcePath(extractRestfulTail(raw));
    return parts === undefined
      ? { raw, kind: "absolute" }
      : {
          raw,
          kind: "absolute",
          type: parts.type,
          id: parts.id,
          ...(parts.version !== undefined ? { version: parts.version } : {}),
        };
  }

  // Relative RESTful reference: `Type/id[/_history/vid]` on the same server.
  const relative = matchResourcePath(raw);
  if (relative !== undefined) {
    return {
      raw,
      kind: "relative",
      type: relative.type,
      id: relative.id,
      ...(relative.version !== undefined ? { version: relative.version } : {}),
    };
  }

  // Everything else — `urn:uuid:`, `urn:oid:`, a bare token — is a logical reference.
  return { raw, kind: "logical" };
}

/**
 * Return the `Type/id[/_history/vid]` tail of an absolute URL by walking back from the end to the
 * segment that looks like a resource type. Keeps the last one or two (or four, with a version)
 * path segments so `matchResourcePath` can validate them.
 *
 * @internal
 */
function extractRestfulTail(url: string): string {
  const segments = url.split("/").filter((s) => s.length > 0);
  const historyIndex = segments.lastIndexOf("_history");
  if (historyIndex >= 2 && historyIndex === segments.length - 2) {
    return segments.slice(historyIndex - 2).join("/");
  }
  if (segments.length >= 2) {
    return segments.slice(-2).join("/");
  }
  return url;
}
