# @cosyte/fhir

Our FHIR R4 library for Node.js and TypeScript (npm, MIT, zero runtime dependencies). It reads JSON
and XML leniently into an immutable model that keeps every `decimal` and `integer64` as written,
writes FHIR back or refuses to, and validates beside the fail-closed `readSafety` readout.

@AGENTS.md

## Gate

Required checks: `ci / verify` on Node 22 and 24, `ci / actionlint`, `no-emdash / tracked-files`,
and `no-internal-refs / public-surface`. CI also runs Node 26, `standards`, fuzz, examples, CodeQL,
and the differential. Put pnpm 10.34.5 first on PATH: pnpm 12 refuses the frozen install, and a test
runs bare `pnpm`. From the repo root, in this order:

```sh
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm format:check
pnpm phi-scan && pnpm test && pnpm test:coverage && pnpm build && pnpm attw
FUZZ_RUNS=20000 pnpm vitest run test/fuzz.test.ts test/phi-leak.test.ts
pnpm typecheck:examples && pnpm lint:examples && pnpm examples && pnpm phi-scan:examples
pnpm check:readme && pnpm check:claude-card && pnpm check:catalog && pnpm check:process
pnpm check:docs-content && pnpm check:docs-reference
pnpm check:no-emdash && pnpm check:no-internal-refs
```

## Hazard

Each resource here can carry a patient's identity and clinical record. The failure that hurts is a
read or write that drops, merges, or invents content yet reports `valid: true`: a retraction lost, a
"no known allergy" asserted, a dose changed. When a value cannot be handled faithfully, report and
refuse; never guess, repair, or affirm. Keep content out of errors and logs.

## Rules

- A repeated JSON property stays first-wins, kept on `FhirComplex.duplicates`, reported, and stops
  `readSafety` affirming: last-wins hid an `entered-in-error` retraction (#32).
- A read and its report widen together, at one window, in one change; count array positions, and
  yield at most one value per member into `system` x `code` (#34).
- Negation reads take no resource-type gate and run at every resource root; `noKnownAllergy` stays
  gated, since it asserts something positive (#81, #82, #83).
- Content the model cannot place draws a diagnostic and comes back as inert text, never modeled and
  never dropped (#37, #38, #68, #69). The writers author and repair nothing: an unfaithful write is
  refused with a code read from `SERIALIZE_ERROR_CODES`, never a copy (#59, #64, #65).
- XML names compare as expanded names, never a tag or local name alone, and the narrative is taken
  by `{http://www.w3.org/1999/xhtml}div` before the resource unwrap (#44, #46, #47, #59).
- Diagnostics carry an `IssueCode` and a FHIRPath location, never a value; a name the document
  supplies is bounded in `src/model/path.ts` first (#43).
- The PHI scan's scope and recognizer change together; it reads the git index too, so run it again
  after `git add` (#50, #56, #60, #90).
- The differential's oracle answers no terminology over a network; close a disagreement by fixing a
  fixture or the library, never the comparison (#20, #104). A pinned gap reds when it closes:
  rewrite its test in the same change, and open a test before writing "pinned by a test" (#58).
- `pnpm attw` runs `cosyte-attw`, never bare `attw`, which exits 0 on a pack with no types (#49).
- A `src/` change adds a changeset, a patch unless the operator okays a minor (2026-11-07); its text
  is the release body: short, no internal ids. Never hand-edit `CHANGELOG.md` (#39, #100, #111).
- Public surfaces (`README.md`, `docs-content/`, `/** */` comments, `src/` strings) carry no item
  ids or private paths: translate the line, never delete a doc comment (#31).
- npm refused full fhir tarballs with a bare `E403` (0.0.11, the first 0.1.0) and took every one cut
  to the runtime files: keep `files` that narrow and the name (#55, #134). Never call a publish done
  or failed from one registry read; a 404 seconds after a publish means nothing (#107, #109).
