---
"@cosyte/fhir": patch
---

Add a minimal, contract-compliant `docs-content/` producer surface (DOCS-CONTENT-P8): `intro.md` +
`sidebars.json`, plus the `pack:docs` script (`scripts/build-docs-artifacts.sh`) that packs the
`docs-content.tar.gz` + `source.tar.gz` release artifacts the `cosyte/docs` chrome ingests. This is a
deliberate **Size-S scaffold stub**, not a full documentation pass: the sidebar is the compliant
Overview-only spine (`{"docs":["intro"]}`) and `intro.md` carries an **honest pre-alpha / Coming-Soon
status posture** — it mirrors `dicom`/`x12`'s registered-but-disabled state, states plainly what the
parser does today and what is not yet here, and marks the full Diátaxis spine (Installation,
Quickstart, Core Concepts, Guides, Troubleshooting) as deferred until the parser stabilizes toward its
first alpha. No invented placeholder categories, no unshipped-API claims; the docs grow with the
parser.
