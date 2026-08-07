/**
 * Codec diagnostics, the value-free warning registry shared by the JSON **and** XML readers, plus
 * the typed fatal for the JSON reader (the XML reader has its own {@link ../xml/issues.js FhirXmlError}).
 *
 * Two tiers, mirroring the cosyte parser convention (`hl7`'s warnings/errors split):
 *
 * - **Warnings** ({@link FhirIssue}) are recoverable, the reader keeps going and preserves the
 *   data, accumulating a value-free issue so the consumer knows what was tolerated.
 * - **Fatals** ({@link FhirCodecError}) are unrecoverable, malformed JSON, or a primitive/`_`-sibling
 *   array whose lengths disagree so the reader cannot know which value an extension belongs to. The
 *   latter fails *closed*: guessing the alignment could attach an extension to the wrong clinical
 *   value, so the reader refuses rather than risk it.
 *
 * **PHI discipline.** A FHIR resource is PHI by default, and diagnostics are the leak
 * vector. Every issue and every error here is **value-free by construction**: it carries a coded
 * `code`, a `severity`, and an `expression` (a FHIRPath *location* such as `Patient.name[0].given[1]`),
 * never the offending value. The `FhirCodecError` for malformed JSON carries a byte `offset`, not
 * the surrounding text.
 *
 * @packageDocumentation
 */

/**
 * Stable string codes for every warning the JSON reader may emit. Frozen via `as const` so the
 * `IssueCode` union is exact and a comparison is typo-checked. Renaming a code is a breaking change.
 *
 * @example
 * ```ts
 * import { parseResource, ISSUE_CODES } from "@cosyte/fhir";
 * const { issues } = parseResource(json);
 * if (issues.some((i) => i.code === ISSUE_CODES.DECIMAL_PRECISION_AT_RISK)) {
 *   // a value here would have been corrupted by a naive JSON.parse, we preserved it
 * }
 * ```
 */
export const ISSUE_CODES = {
  /**
   * A numeric primitive whose exact value would have been corrupted by routing it through a
   * JavaScript `number`, trailing-zero precision, more than ~15 significant digits, or magnitude
   * past the safe-integer range. Informational: the reader preserved it losslessly; this flags that
   * the protection mattered here.
   */
  DECIMAL_PRECISION_AT_RISK: "DECIMAL_PRECISION_AT_RISK",
  /**
   * A property the reader did not expect at this position and preserved verbatim (Postel's Law,
   * lenient read). Warning severity: nothing was lost, but a consumer may want to know.
   *
   * **Two JSON positions raise it for the same observation, and both preserve the text so that
   * re-reading the writer's output raises it again.** FHIR JSON has an object at each of them
   * (json.html §2.6.2), and what arrived was a string, a number, a boolean or a `null`: a **complex**
   * element's own position (the text goes to {@link ../model/node.js} `nonObjectSource`), and a
   * primitive's **`_`-sibling**, the channel §2.6.2.3 gives the `id` and/or `extension`
   * (`nonObjectMetaSource`). Neither is modeled as FHIR, at either position, so no walker sees a new
   * element. **A `null` padding a repeating primitive's `_`-array is the one exception §2.6.2.3
   * defines and never draws this.**
   */
  UNKNOWN_PROPERTY: "UNKNOWN_PROPERTY",
  /**
   * The XML reader met content at this position that does not belong to the vocabulary it expected,
   * or that it cannot map to the model. Warning severity: the document is not rejected.
   *
   * **It reports two different observations, and only one of them preserves anything.**
   *
   * - **An element from another vocabulary** (a namespace other than its parent's, or a root
   *   declaring a namespace other than FHIR's). The element **is** modeled; this says the document
   *   left the vocabulary here.
   * - **Non-whitespace character data directly on an element.** A FHIR element carries its value in
   *   the `value` attribute (xml.html), not as text, so there is no slot on the model for it and
   *   the text is **dropped**. That is true at every site this fires for text: on a complex element,
   *   on a primitive (`<status>entered-in-error</status>` loses the status), and beside the one
   *   resource child of a resource-valued element (`<contained>…<Patient/></contained>`). The
   *   guarantee on offer is that the drop is not silent, and nothing more.
   *
   * The narrative `<div>` is the one element whose text is expected, and it is carried whole rather
   * than reported here. **Do not write a claim that this code means the content survived.**
   *
   * **More than one of the observations above can be true at one position, and this code does NOT
   * promise one report per location.** Exactly one site takes care not to be the second: the text
   * report beside the one resource child of a resource-valued element, which is the site added last
   * and the only one that checks. Everywhere else, an element that is both in another vocabulary and
   * carrying character data draws the code twice at one expression. That is the behaviour on every
   * release that has had this code, and a consumer keying on `code` + `expression` should treat it
   * as a set.
   */
  UNEXPECTED_XML_CONTENT: "UNEXPECTED_XML_CONTENT",
  /**
   * A JSON object repeated a property name. FHIR JSON requires unique property names (json.html §2.6.2:
   * "Property names SHALL be unique") and expresses repetition with an array, so a repeated name is
   * a document defect with no defined winner: RFC 8259 §4 says "the behavior of software that
   * receives such an object is unpredictable". The reader keeps the first value in the node's
   * `properties`, keeps the rest in its `duplicates` (nothing is discarded), and raises this. Warning
   * severity: the data survived, but any single-value read of that element is now arbitrary.
   */
  DUPLICATE_PROPERTY: "DUPLICATE_PROPERTY",
  /**
   * A JSON array appeared **inside another array**. FHIR JSON uses an array for one thing only, a
   * repeating element (json.html §2.6.2.2), so no element is ever a list of lists and this shape has
   * no meaning at any position. The reader does not model what was inside, so unlike every other
   * warning here **content the sender wrote is not readable** at this location. That is why it has
   * its own code: an unexpected-property warning says a shape was tolerated, this one says something
   * was there and could not be read, which is what must stop a downstream safety verdict from being
   * affirmed over it. Raised in addition to any other warning the position already drew, never
   * instead of one.
   */
  NESTED_ARRAY: "NESTED_ARRAY",
  /**
   * A `_`-sibling appeared beside an element that is **not** a primitive. FHIR JSON defines the
   * `_`-prefixed property as the carrier for a *primitive* element's `id` and `extension`
   * (json.html §2.6.2.3); a complex element carries both inline, and a complex array's members carry
   * their own, so there is no position for a `_`-sibling on either and no defined meaning for one.
   *
   * The reader does not model what was inside it, so (as with {@link ISSUE_CODES.NESTED_ARRAY})
   * **content the sender wrote is not readable** at this location. That is why it is its own code
   * rather than an {@link ISSUE_CODES.UNKNOWN_PROPERTY}, whose contract is that nothing was lost.
   *
   * The location names the **element**, not the `_`-prefixed member: FHIRPath addresses elements,
   * and `_name` is not an element. It is raised once per misplaced sibling.
   */
  MISPLACED_PRIMITIVE_EXTENSION: "MISPLACED_PRIMITIVE_EXTENSION",
  /**
   * One modeled XML element's occurrences did **not all arrive under the same expanded name**: the
   * namespace and the tag together (Namespaces in XML 1.0 §6.1), not the tag alone. Either half can
   * differ, and the two halves are different situations.
   *
   * - **The tag differs, the namespace does not.** `<f:status/>` beside `<status/>` is one element
   *   written two ways. Nothing is lost and the reading is the correct one: the occurrences are
   *   modeled as repeats of a single element, exactly as the same document spelled one way would be.
   * - **The namespace differs, the tag does not.** Two elements that are not the same element at all
   *   reach one model name under one tag. **This is not a closed list of routes and no sentence here
   *   or anywhere else may make it one**: the rule is simply that the group's occurrences did not all
   *   carry one expanded name. Two worth naming, because they are the ones that read as conformant:
   *   a prefix **rebound between siblings** (`<p:x xmlns:p="urn:a"/>` beside `<p:x xmlns:p="urn:b"/>`,
   *   where the model name of each is that verbatim tag), and a **`<div/>` in the FHIR namespace
   *   beside the narrative**, because the narrative is modeled as `div` under every spelling of the
   *   XHTML namespace. The second is the costlier: `Narrative.div` is `0..1`, so the merge turns the
   *   narrative into a repeat over an otherwise conformant document. A **foreign** element reached by
   *   a **default** `xmlns` re-declaration also keeps its tag verbatim as its model name, so it groups
   *   with its FHIR namesake the same way; there the group additionally carries
   *   {@link ISSUE_CODES.UNEXPECTED_XML_CONTENT}, which is the code to read for it. Whether a group
   *   carries that flag as well is decided by whether each occurrence is foreign **to its own
   *   parent**, so an element in the parent's namespace does not draw it: inside a FHIR-namespace
   *   `<text>`, a `<div xmlns="http://hl7.org/fhir"/>` beside the real XHTML narrative draws this
   *   code and no other, which makes this the only report there is to read for it.
   *
   * It also fires where a prefixed FHIR element groups with an unprefixed one carrying a **foreign**
   * default declaration, because that one is spelled exactly like the FHIR element; there the group
   * additionally carries {@link ISSUE_CODES.UNEXPECTED_XML_CONTENT} at the foreign occurrence, and
   * this code is not the one to read for that. In every case this is raised because
   * the *count* is what changes. An element a consumer expects at most once now presents as a
   * repeat, and a single-value read of a repeated element yields nothing rather than a value, so a
   * check written against `0..1` can skip an element it would otherwise have inspected. Warning
   * severity: it tells a consumer that the number of occurrences here came from the spelling, not
   * just from the content.
   *
   * The location names the element, once per element, not once per occurrence.
   */
  MIXED_XML_SPELLING: "MIXED_XML_SPELLING",
  /**
   * A JSON `null` sat at a position FHIR JSON does not define one.
   *
   * FHIR JSON forbids `null` and carves out one exception. json.html §2.6.2.1: "properties never have
   * null values (except for a special case documented below)". The exception is §2.6.2.3, and it is
   * about a **repeating** primitive: "In the case where the primitive element may repeat, it is
   * represented in two arrays. JSON null values are used to fill out both arrays so that the id
   * and/or extension are aligned with the matching value in the first array."
   *
   * So this is raised for a `null` that is **not** that. Two conditions, both required for the
   * exception to apply: the `null` sat **inside a repeating primitive's value array**, and the slot
   * it produced **carries an `id` or a non-empty `extension`** for it to align with. A `null` failing
   * either leaves an element with neither a value nor children, which R4 `ele-1` requires one of.
   * A padding `null` in a conformant document never draws it.
   *
   * **A singleton slot is never padding, whatever sits beside it.** §2.6.2.3 states the singleton
   * encoding positively: "If the primitive has an id attribute or extension, but no value, only the
   * property with the `_` is rendered." So a value-absent singleton is `{"_status":{…}}`, and both
   * `{"status":null}` and `{"status":null,"_status":{…}}` draw this.
   *
   * **The set this walks is what the reader read as a primitive, not what FHIR types as one.** The
   * model is schema-free, so a bare `null` at any **singleton** property reaches the primitive branch
   * whatever that element's FHIR type would be: `{"subject":null}` on an `Observation` draws this
   * code, even though `Observation.subject` is a `Reference`. Only an **array item** and a
   * `_`-sibling's `extension` item reach the complex branch (see below).
   *
   * **Unlike {@link ISSUE_CODES.NESTED_ARRAY}, this does not say content was unreadable.** A `null`
   * carries nothing, so nothing was lost; the element really is value-absent. What it says is that
   * the document encoded that absence in a way FHIR JSON does not define, which matters because the
   * absence is otherwise indistinguishable from an element the sender legitimately omitted, and a
   * `Quantity` that arrives as `{"value":null,"unit":"mg"}` would then read back as a conformant
   * quantity with a unit and no magnitude. `serializeResource` writes the `null` back for exactly
   * that reason, so the finding survives a round trip rather than being laundered away. Warning
   * severity.
   *
   * **The neighbouring position has its own code and is not this one.** A `null` the reader takes to
   * the complex branch preserves its text ({@link ../model/node.js} `nonObjectSource`) and raises
   * {@link ISSUE_CODES.UNKNOWN_PROPERTY} instead; that behaviour is unchanged and no case moved onto
   * this code. **The predicate, rather than a list of the documents that satisfy it:** a `null`
   * reaches the complex branch when it is an item of an array the reader read as a *complex* array
   * (its first non-`null` item is not a scalar, so an object **or** an inner array puts it there), or
   * an item of a `_`-sibling's `extension` array. A `_`-sibling that is itself not an object
   * (`"_status":null`) is a third position, and it draws {@link ISSUE_CODES.UNKNOWN_PROPERTY} too:
   * FHIR JSON has an `Element` object in that channel, so a `null` there is the scalar-where-an-object
   * -belongs observation rather than this one. **No case has ever moved between the two codes**; that
   * channel drew nothing at all until it was closed, so a predicate written against either is
   * unchanged by it.
   */
  UNDEFINED_JSON_NULL: "UNDEFINED_JSON_NULL",
} as const;

/** Discriminant union of every {@link ISSUE_CODES} value. */
export type IssueCode = (typeof ISSUE_CODES)[keyof typeof ISSUE_CODES];

/** FHIR issue severities carried by a warning (the recoverable subset of the R4 set). */
export type IssueSeverity = "warning" | "information";

/**
 * A single value-free diagnostic accumulated during a lenient read.
 *
 * `expression` is a FHIRPath location into the document (e.g. `Bundle.entry[2].resource.ofType(Patient).name[0].given[1]`,
 * or a simpler `Patient.birthDate`), it says *where* without echoing *what*. It never contains a
 * resource value, so an issue is safe to log.
 *
 * **It is a location, and on non-conformant input it can be a location with a gap.** The segments
 * are the document's own names, and a name is echoed only when it matches the published form of a
 * FHIR name; anything else reads as the {@link ../model/path.js} `WITHHELD` marker, `"<withheld>"`.
 * A marker is not a FHIRPath identifier, so such an expression will not resolve against the
 * instance: R4 defines `OperationOutcome.issue.expression` as a FHIRPath subset that SHALL resolve
 * to a single node, and a location with a withheld segment does not. Every segment around the
 * marker is intact, so the nearest addressable ancestor is still there. Test for the marker before
 * handing an expression to a FHIRPath engine.
 */
export interface FhirIssue {
  readonly code: IssueCode;
  readonly severity: IssueSeverity;
  readonly expression: string;
}

/**
 * Build a {@link ISSUE_CODES.DECIMAL_PRECISION_AT_RISK} issue at `expression`.
 *
 * @example
 * ```ts
 * import { decimalPrecisionAtRisk } from "@cosyte/fhir";
 * const issue = decimalPrecisionAtRisk("Observation.valueQuantity.value");
 * ```
 */
export function decimalPrecisionAtRisk(expression: string): FhirIssue {
  return { code: ISSUE_CODES.DECIMAL_PRECISION_AT_RISK, severity: "information", expression };
}

/**
 * Build a {@link ISSUE_CODES.UNKNOWN_PROPERTY} issue at `expression`.
 *
 * @example
 * ```ts
 * import { unknownProperty } from "@cosyte/fhir";
 * const issue = unknownProperty("Patient.wibble");
 * ```
 */
export function unknownProperty(expression: string): FhirIssue {
  return { code: ISSUE_CODES.UNKNOWN_PROPERTY, severity: "warning", expression };
}

/**
 * Build a {@link ISSUE_CODES.UNEXPECTED_XML_CONTENT} issue at `expression` (XML reader only).
 *
 * @example
 * ```ts
 * import { unexpectedXmlContent } from "@cosyte/fhir";
 * const issue = unexpectedXmlContent("Observation.status");
 * ```
 */
export function unexpectedXmlContent(expression: string): FhirIssue {
  return { code: ISSUE_CODES.UNEXPECTED_XML_CONTENT, severity: "warning", expression };
}

/**
 * Build a {@link ISSUE_CODES.DUPLICATE_PROPERTY} issue at `expression`.
 *
 * The location names the element, not the individual member: FHIRPath addresses elements, and a
 * repeated JSON name is not addressable, so both the surviving and the shadowed member report here.
 *
 * @example
 * ```ts
 * import { duplicateProperty } from "@cosyte/fhir";
 * const issue = duplicateProperty("Observation.status");
 * ```
 */
export function duplicateProperty(expression: string): FhirIssue {
  return { code: ISSUE_CODES.DUPLICATE_PROPERTY, severity: "warning", expression };
}

/**
 * Build a {@link ISSUE_CODES.NESTED_ARRAY} issue at `expression`.
 *
 * The location is the position the inner array occupied, so it indexes into the outer array
 * (`Patient.name[0]`, `Patient.name[0].given[1]`), which is as close as FHIRPath can get to a shape
 * FHIRPath cannot address.
 *
 * @example
 * ```ts
 * import { nestedArray } from "@cosyte/fhir";
 * const issue = nestedArray("Patient.name[0]");
 * ```
 */
export function nestedArray(expression: string): FhirIssue {
  return { code: ISSUE_CODES.NESTED_ARRAY, severity: "warning", expression };
}

/**
 * Build a {@link ISSUE_CODES.MISPLACED_PRIMITIVE_EXTENSION} issue at `expression`.
 *
 * The location is the element the `_`-sibling was written beside (`Patient.name`), because the
 * `_`-prefixed member itself is not addressable in FHIRPath.
 *
 * @example
 * ```ts
 * import { misplacedPrimitiveExtension } from "@cosyte/fhir";
 * const issue = misplacedPrimitiveExtension("Patient.name");
 * ```
 */
export function misplacedPrimitiveExtension(expression: string): FhirIssue {
  return { code: ISSUE_CODES.MISPLACED_PRIMITIVE_EXTENSION, severity: "warning", expression };
}

/**
 * Build a {@link ISSUE_CODES.MIXED_XML_SPELLING} issue at `expression` (XML reader only).
 *
 * The location names the element whose occurrences did not all arrive under one expanded name,
 * raised once for that element rather than once per occurrence.
 *
 * @example
 * ```ts
 * import { mixedXmlSpelling } from "@cosyte/fhir";
 * const issue = mixedXmlSpelling("Observation.status");
 * ```
 */
export function mixedXmlSpelling(expression: string): FhirIssue {
  return { code: ISSUE_CODES.MIXED_XML_SPELLING, severity: "warning", expression };
}

/**
 * Build a {@link ISSUE_CODES.UNDEFINED_JSON_NULL} issue at `expression`.
 *
 * The location is the primitive slot the `null` occupied, so it indexes into a repeating element
 * (`Patient.name[0].given[1]`) where the `null` sat in an array, and names the element itself
 * (`Observation.status`) where it did not.
 *
 * @example
 * ```ts
 * import { undefinedJsonNull } from "@cosyte/fhir";
 * const issue = undefinedJsonNull("Observation.valueQuantity.value");
 * ```
 */
export function undefinedJsonNull(expression: string): FhirIssue {
  return { code: ISSUE_CODES.UNDEFINED_JSON_NULL, severity: "warning", expression };
}

/**
 * Stable string codes for the reader's unrecoverable fatals. Everything less severe is a recoverable
 * {@link FhirIssue}.
 */
export const FATAL_CODES = {
  /** The input is not well-formed JSON. */
  MALFORMED_JSON: "MALFORMED_JSON",
  /**
   * A primitive value array and its `_`-sibling array have different lengths, so the null-padded
   * index alignment is broken and the reader cannot know which value each extension belongs to
   * (cf. HAPI #5738). Fails closed, see the module doc.
   */
  PRIMITIVE_EXTENSION_MISALIGNED: "PRIMITIVE_EXTENSION_MISALIGNED",
  /**
   * JSON nested deeper than the reader's fixed bound. Well-formed but pathological input (a tower of
   * `[[[[…]]]]` / `{"a":{"a":…}}`) is refused as a **DoS guard**, turning what would otherwise be a
   * V8 stack overflow (`RangeError`, environment-dependent, untyped) into a typed, value-free fatal
   * carrying a byte `offset`. Mirrors the XML reader's `MAX_DEPTH_EXCEEDED` (fuzzing: deep
   * nesting must never crash/hang/OOM, always a typed error or a bounded rejection).
   */
  MAX_DEPTH_EXCEEDED: "MAX_DEPTH_EXCEEDED",
} as const;

/** Discriminant union of every {@link FATAL_CODES} value. */
export type FatalCode = (typeof FATAL_CODES)[keyof typeof FATAL_CODES];

/**
 * Thrown by the JSON reader on an unrecoverable structural failure. Carries the coded reason, a
 * FHIRPath `expression` location (for a misalignment) or an `offset` byte position (for malformed
 * JSON), and, by design, **no** slice of the offending input, because that slice could be PHI.
 *
 * @example
 * ```ts
 * import { parseResource, FhirCodecError, FATAL_CODES } from "@cosyte/fhir";
 * try {
 *   parseResource(feed);
 * } catch (err) {
 *   if (err instanceof FhirCodecError && err.code === FATAL_CODES.PRIMITIVE_EXTENSION_MISALIGNED) {
 *     // the `_`-sibling alignment was broken at err.expression
 *   }
 * }
 * ```
 */
export class FhirCodecError extends Error {
  public readonly code: FatalCode;
  /** FHIRPath location of the failure, when it has one (misalignment). */
  public readonly expression: string | undefined;
  /** Byte offset into the input, when it has one (malformed JSON). */
  public readonly offset: number | undefined;

  /**
   * @param code - The fatal reason.
   * @param message - A PHI-safe description, must not embed any input value.
   * @param location - Either a FHIRPath `expression` or a byte `offset`.
   * @internal
   */
  public constructor(
    code: FatalCode,
    message: string,
    location: { expression?: string; offset?: number } = {},
  ) {
    super(message);
    this.name = "FhirCodecError";
    this.code = code;
    this.expression = location.expression;
    this.offset = location.offset;
  }
}
