---
"@cosyte/fhir": patch
---

A caller reading a US Core instance can now tell an element the source system explicitly does not
know from one it simply did not send (`MISSING-DATA-1`).

A source system with no data for an element whose minimum cardinality is greater than zero cannot
omit it. US Core's Missing Data rule says it SHALL be present anyway, and for a non-coded element it
is written present, with no value, carrying the R4 DataAbsentReason extension and a reason code.
Measured at the base commit: this package read that element into a value-absent primitive, so the
element counted as present and no required-element finding fired, and every value reader returned
`undefined` -- the same `undefined` an element the sender never wrote returns. "We asked and nobody
knows" and "we never sent this" were therefore one answer, and the only way to tell them apart was to
re-read the wire document.

`readSafety` now carries `absenceMarkers`, one `{ code, location }` per declared absence, and
`absenceMarkers(resource, path)` is the standalone collector. It reads the extension on a complex
element and on a primitive's extension metadata (the `_`-sibling in JSON, a child `<extension>` in
XML), from either wire format, on any resource type, at every depth, so a marker inside `contained`
or a `Bundle.entry` is surfaced with a location that names where it sits. It carries the reason the
sender spelled rather than the bare fact of an absence, so `unknown` is distinguishable from
`masked`, from `not-applicable` and from `not-performed` on otherwise identical instances. The three
inputs the whole thing is about -- the element omitted, the element marked, the element carrying an
ordinary value -- are now three distinguishable readings from the package's own API.

It is the one location-bearing channel on that readout that leaves `safeToSummarize` standing, and
the exception is the point rather than a hole in the rule. Every other channel there marks something
the library could not read or could not rank; a readable, non-conflicting declaration is the
opposite, so refusing to summarize over it would withdraw an affirmation from a conformant document,
which is the one direction this layer's contract forbids. Required-element reporting does not move
in either direction either: a mandatory element present with only a marker draws no
`CARDINALITY_MIN`, because the pattern requires exactly that encoding, and one omitted entirely still
draws it.

Two neighbours behave like every other refusal here. A reason outside the closed fifteen-concept
value set the extension's `value[x]` binds to at required strength is not read, and is never folded
into `unknown`: FHIR `code` is case-sensitive and its lexical space excludes surrounding whitespace,
so `UNKNOWN` and a padded `unknown` are not the code, and coercing either would author a reason
nobody spelled. The element is not read as populated either. The location goes on
`unreadableAbsenceMarkers`, `safeToSummarize` is `false`, `assertSafeToSummarize` throws, and
`validateResource` raises the new `ABSENCE_MARKER_UNREADABLE` (error, `code-invalid`). The same
covers a marker with no `valueCode`, one holding no readable string, an empty one, and one written
twice with no rule for ranking the two. And a marker beside a value on one element is a contradiction
this library does not resolve: the value stays in the model, the declaration stays on
`absenceMarkers`, the location goes on `conflictingAbsenceMarkers`, and the new
`ABSENCE_MARKER_CONFLICT` (error, `structure`) reports that they disagree, rather than letting a
consumer silently prefer whichever of the two its own read happened to reach first. A complex element
counts as carrying a value when it holds any member beyond `id`, `url`, `extension`,
`modifierExtension` and the JSON encoding's `resourceType`, none of which is a value a marker denies;
`resourceType` is excluded for a sharper reason than the rest, being how FHIR JSON names the type
where FHIR XML spells it as the tag, so counting it would make the two wire formats disagree about
one instance.

Two neighbouring shapes are deliberately NOT this, and both are pinned in both directions. The same
concepts used as a `Coding` inside a coded element are a present, conformant coded VALUE, not an
absent element, and draw nothing. Nor is the `Observation.dataAbsentReason` ELEMENT: that is an
ordinary `CodeableConcept` with its own `obs-6` invariant, which is unchanged, still fires exactly
once beside a `value[x]`, and never arrives alongside an absence finding, because the element is not
the extension. Recognition is by the extension definition's own canonical `url` and nothing that
resembles it, so an extension whose `url` is the code system URI instead is not a marker; one
published implementation guide page writes it that way, which is an error on that page.

A report carries the reason and a FHIRPath location and nothing else from the document. The reason
is safe to carry for the same reason the retraction and negation codes are: it is one of fifteen
literal strings this package spells in its own source, exported as `ABSENCE_CODES` with the
`isAbsenceCode` membership test and the `DATA_ABSENT_REASON_URL` constant beside them. A code that
failed that test is carried nowhere. Locations go through the same segment bound every other location
in this package goes through, so a forged property name reads as the withheld marker, and the
diagnostic-surface sweep and the name-echo suite both cover the new channels. No terminology service,
value-set expansion, bundled terminology or profile content is involved, and no runtime dependency
was added. Nothing on the profiles surface was touched.

Nothing a document without a DataAbsentReason extension draws has changed: the base-versus-head
readout differential over the JSON corpus is unchanged on every channel it compares, with no finding
added, withdrawn, re-severitied or relocated and no `safeToSummarize` moved.
