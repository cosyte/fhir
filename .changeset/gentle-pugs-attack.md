---
"@cosyte/fhir": patch
---

`serializeResourceXml` no longer emits a name that authors elements the sender never wrote
(`FHIR-UNBOUND-PREFIX-ROUNDTRIP`).

The XML writer built a start tag by interpolating a name the document supplied, with no check. The
model is schema-free and the JSON reader admits any member name, so arbitrary text reached the tag
position. For one shape of it the emitted markup is well-formed XML that a conformant parser accepts
as a **different set of elements**: an `Observation` whose only member is spelled
`zz value="1"/><status` reads with no diagnostics, `valid: true` and no status, and emitted
`<zz value="1"/><status value="final"/>`, which re-reads as an `Observation` whose status is `final`.
A clinical value fabricated across one round trip, with zero diagnostics on both sides.

The writer now refuses, with a new `SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME`, at every
position that writes a tag: a property name, a root `resourceType`, the wrapper of a resource-valued
element, and a nested resource's own type. Refusing rather than repairing, because XML has no escape
for an element name, so the alternatives are mangling the name or emitting the breakout, and both
author content nobody wrote. The capability is routed rather than lost: `serializeResource` escapes
a member name and encodes every one of these models correctly. Locations stay bounded and never echo
the offending name, which can itself be a forgery.

The line is deliberately narrow: "does this library's own round trip survive it", not "is this a
conformant XML name". A prefixed name with nothing to bind it (`<v:x/>`), and names like `a&b`,
`1abc`, `-lead` and `a"b`, are rejected by a conformant third-party parser and are **still written**,
because they round-trip through this library unchanged today and refusing them would withdraw that
from documents that read `valid: true`. That gap is stated on `serializeResourceXml` and pinned by
tests. Unreachable for a model read from XML, whose tag scanner cannot produce such a name, so no XML
document loses the ability to be written back.

**This governs names, and it is not a guarantee that the writer emits only elements the sender
wrote.** A separate and larger route, pre-existing and NOT closed here, is now measured and named on
`serializeResourceXml`: a `div` property is written back as its own raw string, so a **balanced**
string that closes its own element and opens siblings puts spec-clean FHIR into the output that
nobody wrote, and it re-reads as ordinary content of the resource with no diagnostic at either end. A
`div` carrying a `716186003` coding on an `AllergyIntolerance` comes back with `noKnownAllergy: true`
and a `no-known-allergy` negation over a record that asserted nothing. The branch keys on the name
`div` alone, so it is not confined to `Narrative.div`, and well-formedness validation does not close
it, because the harmful shape is well-formed.
