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
author content nobody wrote. The capability is routed rather than lost: `serializeResource` escapes a
member name, so this refusal never reaches it and that route stays open. **That is a statement about
the name, not about the model.** The JSON writer has its own declared exceptions, so a model refused
here can carry one and have it emitted:
`{"resourceType":"Observation","name":[[{"family":"X"}]],"zz value="1"/><status":1}` is refused here
and comes back out of `serializeResource` with `"name":[[{"family":"X"}]]` intact, an array inside an
array and the first entry on that writer's own exception list. Pinned by a test rather than
described. Locations stay bounded and never echo the offending name, which can itself be a forgery.

The line is deliberately narrow: "does this library's own round trip survive it", not "is this a
conformant XML name". A prefixed name with nothing to bind it (`<v:x/>`), and names like `a&b`,
`1abc`, `-lead` and `a"b`, are rejected by a conformant third-party parser and are **still written**,
because they round-trip through this library unchanged today and refusing them would withdraw that
from documents that read `valid: true`. That gap is stated on `serializeResourceXml` and pinned by
tests. Almost every model that reaches the refusal came from JSON, because the XML tag scanner cannot
read a tag carrying one of those characters. The one exception is a prefixed name whose local part
begins `!` or `?` (`<a:!x xmlns:a="http://hl7.org/fhir" value="1"/>`), which reads clean and is now
refused where it used to be written as markup this library could not re-read.

**This governs names, and it is not a guarantee that the writer emits only elements the sender
wrote.** A separate and larger route, pre-existing and NOT closed here, is now measured and named on
`serializeResourceXml`: a `div` property is written back as its own raw string, examined by nothing,
so markup inside it is markup in the output. A `div` on an `AllergyIntolerance` that closes its own
element and opens a `716186003` coding comes back with `noKnownAllergy: true` and a
`no-known-allergy` negation over a record that asserted nothing, with no diagnostic at either end.
The branch keys on the name `div` alone, so it is not confined to `Narrative.div`.
