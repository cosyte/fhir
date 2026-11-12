---
"@cosyte/fhir": patch
---

A reference to an id that names more than one resource is no longer resolved to the first of them. When two `contained` resources carry the same `id`, or two Bundle entries the same `fullUrl` (or claim the same `Type/id`), `resolveReference` now answers `"unresolved"` for a reference to it, where it used to return whichever came first. So a `type` slicing through `resolve()` on such a reference reads `PROFILE_SLICE_UNCHECKED` with `sliceReason: "target-unresolved"` instead of passing on the first resource, and inside a Bundle the reference draws `REFERENCE_UNRESOLVED`.

`validateResource` reports the repeat itself with two new error codes: `CONTAINED_ID_DUPLICATE`, at each contained resource whose `id` an earlier one carries (on the resource validated and inside each Bundle entry), and `FULLURL_DUPLICATE`, at each Bundle entry whose `fullUrl` and `meta.versionId` an earlier entry carries, outside a `history` Bundle, as R4's `bdl-7` requires. Both are value-free.

What a caller sees change: `containedIndex` leaves a repeated id out of `byId` and lists it on the new optional `repeatedIds`; `buildBundleIndex` leaves a repeated `fullUrl` or `Type/id` out of `byFullUrl` and `byTypeId` and lists it on `repeatedFullUrls` or `repeatedTypeIds`. Code that read `byId`, `byFullUrl` or `byTypeId` directly and relied on the first entry now finds nothing under that key; an index built by hand without the new fields resolves as before. Code with an exhaustive table keyed by `ValidationCode` needs the two new codes. Every unique id, `fullUrl` and `Type/id` resolves as before.
