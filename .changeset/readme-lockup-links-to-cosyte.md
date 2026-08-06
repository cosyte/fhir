---
"@cosyte/fhir": patch
---

The Cosyte lockup at the top of the README is now a link to `cosyte.com`.

The `<picture>` block above the heading is wrapped in an `<a href="https://cosyte.com">`. Nothing
inside it moved: the `<source>` carrying the on-dark cut, the `<img>` carrying the on-light fallback,
the alt text and both image URLs are exactly as they were, and both URLs were re-checked on the wire
before this landed and returned `200` and `image/png`.

What the anchor does differs by surface, and it was measured rather than assumed.

On GitHub the anchor works and the colour-scheme switch keeps working. GitHub's repository rendering,
handed this exact block, returns the `<a>` intact with the `<img>` still a direct child of
`<picture>`, which is the condition a `<source>` needs in order to apply. The same structure was read
off the live rendering of a third-party README carrying the same shape.

On an npm package page the anchor does not survive. npm's pipeline wraps a README `<img>` in its own
anchor pointing at the image file. An `<a>` nested inside another `<a>` is not representable in HTML,
so the parser closes the outer anchor early and the `<img>` ends up outside both the `<picture>` and
the link. The image still renders, and it renders the on-light fallback, which is the right cut for a
page that has no dark mode. What is lost is the link target: the image points at the image file rather
than at `cosyte.com`, and an empty anchor with no accessible name is left beside it. That is a real
cost and it is recorded rather than hidden. It takes nothing away that was there before, because the
image npm would show is the same one it would have shown without the anchor.

This package has no page on the npm registry today, so GitHub is the only surface on which any of this
is currently visible.

Nothing else on the page moved. The heading, the opening summary and every code sample are unchanged,
and no resource model, `IssueCode`, validation verdict, codec output or value-free diagnostic differs.
