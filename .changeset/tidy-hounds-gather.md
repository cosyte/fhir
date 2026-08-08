---
"@cosyte/fhir": patch
---

Report a `_`-sibling that is not an object, and write it back instead of deleting it.

FHIR JSON gives a primitive's `_`-sibling an `Element` object and nothing else (json.html §2.6.2.3
puts "the `id` and/or `extension`" there), so `parseResource` read no metadata out of a string, a
number, a boolean or a `null` in that channel, and `serializeResource` emits a `_`-sibling only for
metadata the model holds. `{"_status":null}` and `{"_status":"x"}` therefore both came back as `{}`,
with `issues: []`, `valid: true` and `safeToSummarize: true`: a non-conformant document turned into a
conformant one with the member simply gone, and no layer saying so. Nothing was lost in the ordinary
sense, which is why it was invisible.

The reader now raises `UNKNOWN_PROPERTY` at that position and keeps the sibling's JSON text, and the
writer hands it back, so the shape round-trips byte-identically and re-reading the output reproduces
the finding. **No new issue code, and no case moved between codes**: this is the same observation the
reader already makes where a scalar or `null` arrives at a complex position, which FHIR JSON also
gives an object, and those `_`-sibling positions drew nothing at all before.

The §2.6.2.3 padding exemption holds in this channel too: §2.6.2.3 fills out *both* arrays, so a
`null` at a slot of a repeating primitive's `_`-array draws nothing, while a `null` at a singleton
`_` slot is never padding and does. A conformant document is unchanged and no round trip was
withdrawn. An array in that channel keeps its existing `NESTED_ARRAY` code and preserved text.

Still open and stated rather than implied: an **empty** `_`-sibling object or array is a different
clause of the spec (§2.6.2.1's "never empty") and is still dropped silently; and a `_`-sibling
object's own unreadable member is reported but the report still does not survive emit.
