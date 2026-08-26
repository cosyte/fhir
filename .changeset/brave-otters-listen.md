---
"@cosyte/fhir": patch
---

Report a JSON `null` at a primitive position, and write it back instead of deleting it.

A `null` in a primitive's value channel was read into a value-absent primitive with no diagnostic,
and a value-absent primitive is omitted on emit. A non-conformant document therefore came back as a
clean, conformant one with the member simply missing, and nothing anywhere said so:
`{"identifier":[{"system":"http://hospital.example/mrn","value":null}]}` parsed with no issues and
re-emitted without the value, `{"value":null,"unit":"mg"}` lost the magnitude and kept the unit (a
quantity that reads as a bare unit rather than as missing), and `"status":null` lost the status.
Nothing was lost in the ordinary sense, because a `null` carries no content. That is exactly what
made it invisible: the output could not be told apart from a document whose sender had legitimately
left the element out.

FHIR JSON defines `null` for one job, padding a repeating primitive's value array so it aligns
index-by-index with the `_`-sibling array carrying that occurrence's `id`/`extension`
(json.html §2.6.2.3, the one exception to §2.6.2.1's "properties never have null values"). The rule
now applied is that one, and it has two conditions, both required for a `null` to be the exception:
it sat **inside a repeating primitive's value array**, and the slot it produced **carries an `id` or
a non-empty `extension`** for it to align with. Padding draws nothing and round-trips byte-for-byte
exactly as before. Anything else leaves an element with neither a value nor children, which R4
`ele-1` requires one of, so the reader raises a new `UNDEFINED_JSON_NULL` warning at that position,
`isUndefinedNull` marks the node, and `serializeResource` writes the `null` back. Re-reading the
output reproduces the finding rather than losing it.

A singleton slot is never padding, whatever sits beside it: §2.6.2.3 renders a value-absent singleton
as the `_` property alone, so `{"status":null,"_status":{…}}` is reported too. The conformant
spelling carries no `null`, is never marked, and is emitted exactly as before, so no round trip was
withdrawn. The set this walks is what the reader read as a primitive, not what FHIR types as one: the
model is schema-free, so `{"subject":null}` on an `Observation` is reported here rather than as an
unexpected property.

This is a diagnostic and not a refusal. A `null` is a non-conformant encoding of an absent value
rather than content the reader could not read, so the refusals that exist for unreadable content are
the wrong instrument, and refusing would withdraw round trips that work today. `validateResource` and
`safeToSummarize` are unchanged.

No existing case moved onto the new code. A `null` written where FHIR JSON has an **object** is a
different branch and still draws `UNKNOWN_PROPERTY` with its text handed back from
`nonObjectSource`; a `_`-sibling that is itself not an object (`"_status":null`) is a separately
declared open gap and is not covered here. The writer's declared exception list named only the object
branch, so it read as though the whole class were handled; it now names the primitive branch as a
fourth exception, in the API documentation and in the README.
