/**
 * Bounded rendering of the names a **document** supplies, for the FHIRPath `expression` that every
 * diagnostic carries as its location.
 *
 * A finding's `expression` is built out of the names in front of the reader: `Patient.birthDate`
 * is the resource's own `resourceType` string joined to its own JSON property names. On a
 * conformant resource those are element names, which is why they are safe to report. On input that
 * is *not* conformant they are whatever the sender wrote, so an unbounded echo of them is a way for
 * document content to reach a log through a diagnostic that promises to carry none.
 *
 * ## Why a shape test rather than a length cap
 *
 * Truncating to N characters still emits the first N characters of whatever was there. A shape test
 * refuses the whole segment instead, and it can do that safely because FHIR gives both kinds of
 * name a narrow published form:
 *
 * - **Element name.** R4 `elementdefinition.html` constrains `ElementDefinition.path` twice.
 *   `eld-19` is a **Rule**, "Element names cannot include some special characters", and caps each
 *   dot-separated segment at **64 characters**. `eld-20` is a **Warning**, "Element names should be
 *   simple alphanumerics with a max of 64 characters, or code generation tools may be broken", and
 *   its regex spells the two arms out: `[A-Za-z][A-Za-z0-9]*` for the leading segment (the type)
 *   and `[a-z][A-Za-z0-9]*` for every segment after it (the elements).
 * - **Resource type name.** Measured over the R4 `resource-types` code system rather than assumed:
 *   all **148** codes are letters only with an initial capital, between 4
 *   (`Flag`, `Goal`, `List`, `Slot`, `Task`) and 33 (`MedicinalProductUndesirableEffect`)
 *   characters. That is tighter than `eld-20`'s leading arm, which also admits digits, and the
 *   tightening is what the measurement buys.
 *
 * A conforming name is returned unchanged, so every legitimate resource reports exactly the
 * locations it reported before and well-formed input sees no change at all.
 *
 * ## Where a shape test bottoms out, stated rather than papered over
 *
 * A forged name that happens to match is still returned. A JSON key spelled `johnsmith` is
 * indistinguishable from an element name, and a type spelled `Chalmers` is indistinguishable from a
 * resource type. The residue is a segment of at most 64 characters, alphanumeric with no
 * separator of any kind, lower case at the front for an element and letters only for a type. So the
 * claim to make about a location is that the echo is **bounded**, which is checkable, rather than
 * that it carries no document content, which this cannot deliver.
 *
 * ## What a withheld segment costs the reader of a finding
 *
 * {@link WITHHELD} is not a FHIRPath identifier, so an `expression` containing one is a location
 * with a suppressed segment rather than a navigable path. That is deliberate and it is the safe
 * direction: the alternative is to name the position by echoing the thing that failed the shape
 * test. A finding still carries its code, its severity, and every segment around the withheld one,
 * so the parent element is still addressable.
 *
 * @packageDocumentation
 */

/**
 * What a location prints in place of a name it may not echo.
 *
 * Deliberately carries **no length**, because the length of a refused name is itself derivable
 * information about the content that was there.
 */
export const WITHHELD = "<withheld>";

/** The published forms a document-supplied name is required to match to be echoed. */
const DERIVED_NAME_SHAPES = {
  /**
   * An element name: `eld-20`'s non-leading arm `[a-z][A-Za-z0-9]*`, capped at `eld-19`'s 64
   * characters per segment.
   *
   * The leading-lower-case requirement is not cosmetic. It is what separates an element name from
   * the two shapes document content most often takes at this position: a proper noun and a
   * capitalised identifier.
   *
   * **Measured against R4's own element definitions rather than assumed.** Across the 7,696 element
   * paths in `profiles-resources.json` and `profiles-types.json` there are 1,423 distinct non-root
   * segments, and the only 74 that fail this arm are `choice[x]` *definition* spellings
   * (`abatement[x]`), whose stems all pass. A `[x]` form is never a JSON property name: the key a
   * document actually writes is the resolved variant (`abatementDateTime`), which passes. The
   * synthetic `resourceType` property the readers write passes too, so a conformant document loses
   * nothing.
   */
  elementName: /^[a-z][A-Za-z0-9]{0,63}$/,
  /**
   * A resource type name: letters only, initial capital, at most 64 characters. Measured over the
   * R4 `resource-types` code system (148 codes, all of them letters only with an initial capital,
   * longest 33 characters) rather than taken from `eld-20`'s leading arm, which also admits digits.
   *
   * This arm is for a `resourceType`, not for the root of any `StructureDefinition`: the primitive
   * datatype definitions are rooted at lower-case names (`boolean`, `code`, `string`), and none of
   * those is ever a document's declared type.
   */
  resourceTypeName: /^[A-Z][A-Za-z]{0,63}$/,
} as const;

/** Which published form a document-supplied name is required to match. */
export type DerivedNameKind = keyof typeof DERIVED_NAME_SHAPES;

/**
 * Render a name the document supplied, for use as a segment of a diagnostic location.
 *
 * Returns the name unchanged when it matches the shape its `kind` promises, and {@link WITHHELD}
 * otherwise.
 *
 * @param value - The name exactly as the document wrote it.
 * @param kind - The published form it claims to have.
 * @returns The name, or {@link WITHHELD}.
 * @internal
 */
export function safeDerivedName(value: string, kind: DerivedNameKind): string {
  return DERIVED_NAME_SHAPES[kind].test(value) ? value : WITHHELD;
}

/**
 * The location of a child element: `parent` joined to a document-supplied element `name`.
 *
 * An empty `parent` yields the bounded name on its own, which is the shape a reader uses before it
 * has read a `resourceType` to root the path with.
 *
 * @param parent - The location of the node holding this element (`""` when there is none yet).
 * @param name - The property name exactly as the document wrote it.
 * @returns The child's location, with the name bounded.
 * @internal
 */
export function childPath(parent: string, name: string): string {
  const segment = safeDerivedName(name, "elementName");
  return parent === "" ? segment : `${parent}.${segment}`;
}

/**
 * The location of a resource root: the document's own `resourceType`, bounded.
 *
 * @param type - The resource type exactly as the document wrote it.
 * @returns The root location.
 * @internal
 */
export function rootPath(type: string): string {
  return safeDerivedName(type, "resourceTypeName");
}
