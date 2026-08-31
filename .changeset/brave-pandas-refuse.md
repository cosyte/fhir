---
"@cosyte/fhir": minor
---

A resource read from an XML root in another vocabulary is no longer written back as authoritative
FHIR (`XML-RESIDUAL-1`).

Measured at the base commit `2ac2d72`, four observations in order over
`<v:Observation xmlns:v="urn:vendor"><v:id value="o1"/><v:status value="entered-in-error"/><v:code><v:text value="synthetic"/></v:code></v:Observation>`:
the first read reported exactly one issue, an `UNEXPECTED_XML_CONTENT` warning at `Observation`;
`validateResource(...).valid` was `true`, because that flag is a warning and is the whole of what the
reading says about the vocabulary; `serializeResourceXml` emitted
`<Observation xmlns="http://hl7.org/fhir">...</Observation>` containing no trace of `urn:vendor`; and
the re-read of that output carried an issue list of `[]`, `valid: true`, and re-emitted
byte-identically to the same resource authored in FHIR from the start. One write and one re-read and
the vendor document was indistinguishable from FHIR. The default-declaration spelling
(`<Observation xmlns="urn:vendor">`) laundered identically and had never been pinned.

`serializeResourceXml` now refuses such a model with `UNSERIALIZABLE_FOREIGN_ROOT`. The refusal
covers both spellings of a root that RESOLVED to a namespace other than the FHIR one, and it reaches
every depth a vendor-rooted resource is composed into, because parse-then-compose is ordinary use of
the public API and a resource dropped into a `Bundle.entry` launders exactly as it did at a root.

The model carries a MARKER, never the vocabulary. Two routes were open: preserve the root's namespace
on the model and write it back, or refuse the write. The refusal shipped, because the namespace URI
is document content and it is precisely the content this residual is about, so preserving it would
put a vendor URI within reach of every walker and every diagnostic. `FhirComplex.foreignRoot` is a
literal `true`, set by the XML reader at a document root and nowhere else and read with the new
public `isForeignRoot`, so the refusal's message and its locations carry no namespace, no tag as the
document spelled it, and no value. A root whose local name is not shaped like a published resource
type is reported as `<withheld>` rather than echoed. Recovering the vocabulary instead is not refuted,
only not taken, and it would restore the round trip this withdraws.

The read is unchanged. The same one warning at the same location, and the document is still `valid` on
the way in: nothing was widened, and the marker records on the model a position the reader was already
reporting.

What it costs, stated rather than implied. This withdraws an XML round trip from a document that reads
`valid: true`, because the root flag is a warning. Two refusals beside it already pay that cost on
documents of their own that read with zero issues; this is the third. The cost is bounded to the class
and the bound is pinned: a FHIR-rooted document still round-trips byte-identically, a root declaring no
namespace at all is still read as FHIR and still written, a root carrying a prefix bound to nothing is
still modeled under its verbatim tag and still written, and `serializeResource` emits every one of
them, this class included. That last point is a statement about the JSON writer's output and NOT a
claim that the JSON channel keeps the flag: it does not, the JSON leg of the same trip still launders,
and that half is declared open rather than closed here. The refusal is raised last of all, so a vendor
root that also carries dropped character data still reports `DROPPED_ELEMENT_TEXT`.

The characterization test that pinned the gap was rewritten in the same change to pin the refusal, and
was observed red in eight assertions against the unchanged tree before being made green.

The base-versus-head read differential could not grade this and now says so in its own output. Every
XML fixture in its corpus is FHIR-rooted, so no document in front of the harness has a foreign root
and its `readings moved 0` is true rather than reassuring. Its negative control gained a fourth arm,
`refusalBlindSpots`, which names the writer refusals a run introduces and the lines they turn into
floors. The key is DERIVED, by differencing the two trees' own published refusal codes, so it names
the current change while it is current and names nothing once it has merged, which is the property the
hand-keyed control this file's predecessor deleted could never hold. Both polarities are asserted.
