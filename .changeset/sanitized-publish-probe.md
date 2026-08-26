---
"@cosyte/fhir": patch
---

Narrow the published tarball to the runtime files only, as a diagnostic probe for the standing npm
publish refusal (`FHIR-NPM-NAME`), at npm support's request of 2026-08-26.

`files` previously named `dist` as a directory, so both sourcemaps shipped. Each one embeds
`sourcesContent`, which is the complete original TypeScript of all 47 source files: 613 KB per map,
1.2 MB of the tarball, and the single densest concentration of security vocabulary in the package.
The XML reader is hardened by refusal rather than by resolution, so its source and its doc comments
name what it refuses; a mechanical count over the shipped bytes returns 104 `entity`, 37 `ENTITY`,
29 `XXE`, 28 `billion-laughs` and 26 `DOCTYPE`. Support's list did not mention the sourcemaps, and
they carry more of the content that list describes than every other shipped file together.

`files` now names the four runtime artifacts one by one: the two bundles and the two declaration
rollups. `CHANGELOG.md` leaves the tarball with them, at 269 KB of prose. `README.md` is cut to a
stub, because npm includes a README whatever `files` says, so the allowlist cannot reach it.

Three of the five steps support asked for were already true and were not re-done: the allowlist
existed, no `*.spec.js` could ship under it, and the version is already past their suggested `0.0.9`.
The traced versions are `0.0.2`, `0.0.3`, `0.0.7` and `0.0.8`, and none is re-fired here.

THIS IS A PROBE, NOT A RELEASE SHAPE. The README and the changelog are the package's documentation
and belong in the tarball. Revert this changeset once npm returns a result, whichever way it goes.
