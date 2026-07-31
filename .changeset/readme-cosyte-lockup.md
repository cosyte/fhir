---
"@cosyte/fhir": patch
---

The README now opens with the Cosyte lockup, which follows the reader's light or dark colour scheme.

It is a `<picture>` element above the heading: a `<source>` carrying the on-dark cut for
`prefers-color-scheme: dark`, and an `<img>` carrying the on-light cut as the fallback. A renderer
that drops `<source>` altogether still renders the inner `<img>`, so the worst case is a light-ground
mark on a dark page, never a missing or broken image. Both images were confirmed to return `200` and
`image/png` before this landed.

The alt text describes the artwork, a plus mark set in two overlapping rounded squares beside the
Cosyte wordmark, rather than the package. It is what a screen reader announces and what a reader gets
if the image fails to load, so it says what the image is instead of repeating the heading underneath
it.

GitHub is the only place this renders today, because `@cosyte/fhir` has never reached the npm
registry and so has no package page. The markup is the same one the published siblings carry, so it
is already correct for the day the registry accepts the name.

Nothing else on the page moved. The heading, the opening summary and every code sample are unchanged,
and no resource model, `IssueCode`, validation verdict, codec output or value-free diagnostic differs.
