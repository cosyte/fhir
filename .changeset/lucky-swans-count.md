---
"@cosyte/fhir": patch
---

Cut a claim about what a build produces from an internal gate's rationale.

Development tooling and internal documentation only. No runtime behaviour changes, no published byte
moves, and nothing this touches is listed in `files`, so none of it reaches an installed copy.

`scripts/check-no-internal-refs.sh` explains why `//` comments sit outside the gate's scope, and
grounded that explanation in a sentence asserting, in capitals, that everything in the sources is in
the tarball. The project guide carried the same universal one clause over. A real `npm pack` refutes
it by example: the module docblock of a pure re-export barrel is in no file of the packed tarball,
neither in a plain file nor in a sourcemap's decoded `sourcesContent`, because the bundler elides the
barrel and it declares nothing for the type-declaration rollup to carry.

Both carriers are cut rather than reworded, which is the settled remedy here once a claim has been
corrected and is wrong again. The warning they were grounding is unchanged and still right, and no
replacement set is named, because such a set is a property of a build rather than a fact worth
freezing into prose. What replaces the ground is the method: derive reach from a real `npm pack`,
never from a grep over the sources, and fold newlines and comment markers before matching, or a doc
comment that wraps reads as absent.

The direction is counter-intuitive, so it is now stated where the claim used to be. A wrong "this
ships" costs a needless sweep. A wrong "this does not ship" licenses writing internal bookkeeping
into a file that renders straight into the type declarations, and a published version is permanent. A
type-only module is the trap that proves it: it compiles to no JavaScript and appears in neither
sourcemap, while its interfaces are exactly what the declarations carry.
