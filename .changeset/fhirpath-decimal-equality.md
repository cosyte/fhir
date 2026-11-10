---
"@cosyte/fhir": patch
---

FHIRPath `=` now ignores trailing zeroes when it compares two decimals from the document, as the FHIRPath specification's equality rules say: `1.5 = 1.50` is true, where it was false. The same equality decides `!=`, `in`, `contains`, `distinct()`, `intersect()` and union, so an invariant that compared two such values could have been reported violated or satisfied wrongly before. The model still keeps every decimal exactly as written, and a profile's `fixed[x]` and `pattern[x]` still compare decimals with their precision. `~` stays outside the supported subset and is still reported unchecked.
