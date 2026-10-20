# @cosyte/fhir

`@cosyte/fhir` is our FHIR R4 parser and utility library for Node.js and TypeScript, published to npm under MIT from this public repository. It reads FHIR JSON and XML leniently into an immutable model that keeps every `decimal` and `integer64` exactly as written, writes FHIR back or refuses to, and validates in layers (structure, terminology binding, profiles, a bounded FHIRPath subset) beside a fail-closed safety readout, `readSafety`. It has zero runtime dependencies and mirrors the API shape of `@cosyte/hl7`.

## Gate

From the repo root, in this order, with pnpm 10 (the `packageManager` pin). Where `pnpm --version` prints another major, put the pinned one first on PATH, since pnpm 12 refuses the frozen install and a test shells out to bare `pnpm`: `mkdir -p ~/.pnpm10 && corepack enable --install-directory ~/.pnpm10 pnpm && export PATH="$HOME/.pnpm10:$PATH"`.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm phi-scan
pnpm test
pnpm test:coverage
pnpm build
pnpm attw
FUZZ_RUNS=20000 pnpm vitest run test/fuzz.test.ts test/phi-leak.test.ts
pnpm typecheck:examples
pnpm lint:examples
pnpm examples
pnpm phi-scan:examples
pnpm check:no-emdash
pnpm check:no-internal-refs
```

The first nine are the shared `cosyte/.github` CI ladder, run on Node 22 and 24; the fuzz line and the four examples lines are the `fuzz` and `examples` jobs in `.github/workflows/ci.yml`. CI also loads `dist/` as ESM and as CJS, runs actionlint and CodeQL, packs the tree and installs the tarball into a clean directory, and runs the `differential` job (`pnpm corpus:fetch`, then `pnpm differential` and `pnpm differential:determinism`), which needs `java` and the pinned `validator_cli.jar` at `VALIDATOR_CLI_JAR`; CI provides both.

## Hazard

Every resource this library reads can carry a patient's identity and clinical record, and callers act on what it returns. The failure that hurts is a read or a write that drops, merges or invents content and still calls the document clean: a retraction lost, a "no known allergy" asserted, a dose changed, all under `valid: true`. When a value cannot be read or written faithfully, report it and refuse; never guess, repair or affirm. Keep document content out of errors, diagnostics and logs.

## Rules that bind here

Each names the failure that put it here; the longer story is in `documentation/agent-notes.md`.

- A repeated JSON property stays first-wins, is kept on `FhirComplex.duplicates` and reported, and stops `readSafety` affirming. Never switch to last-wins, which only moves the blind spot: a second `status` hid an `entered-in-error` retraction under `safeToSummarize: true` (#32).
- A read and its report widen together, at one window, in one change: an unwrap inside `codingsOf` that nothing reported erased a true `VITAL_SIGN_UNIT_NONCONFORMANT` and flipped a document to `valid: true`. Count array positions, not strings, and yield at most one value per written member into the `system` x `code` cross-product, since one invented pair is a recorded "no known allergy" (#34).
- Negation reads take no resource-type gate and run at every resource root: gated reads returned `negations: []` and `safeToSummarize: true` for a conformant `doNotPerform` ServiceRequest, a `not-done` Procedure and a retraction inside a Bundle (#81, #82, #83). `noKnownAllergy` stays gated, because it asserts something positive.
- Content the model cannot place (an array inside an array, a `_`-sibling that is not an object, a JSON `null` at a primitive) draws a diagnostic and is handed back as inert text, never modeled as an element and never dropped: modeling it erased a true error and asserted `noKnownAllergy`, and dropping it wrote non-conformant documents back clean (#37, #38, #68, #69).
- The writers author nothing and repair nothing. A model they cannot write faithfully is refused with a code from `SERIALIZE_ERROR_CODES` (read the list there, never from a copy): they once invented a `{}` (#59), authored elements out of a name (#64) and forged a negation out of a `div` (#65).
- The XML reader compares expanded names (namespace and local name), never a tag or a local name alone: a prefixed FHIR document read as properties named `f:active` (#44), and two spellings of one name merged in silence (#59).
- Take the narrative by its expanded name `{http://www.w3.org/1999/xhtml}div` before the resource-valued unwrap: `<BR/>` read as a contained resource and deleted the prose beside it under `valid: true` (#46, #47).
- Diagnostics carry an `IssueCode` and a FHIRPath location, never a value, and a name the document supplies is bounded in `src/model/path.ts` before it reaches a location: a 1 MB property name reached `expression` whole (#43).
- The PHI scan's scope and its recogniser change together, and it sweeps the git index as well as the tree, so re-run `pnpm phi-scan` after `git add`: a symlink, a staged rename, files under `test/` and a fixture staged then scrubbed each read clean (#50, #56, #60, #90).
- The differential's oracle answers no terminology over a network (`-tx n/a -txCache n/a`, declared in `scripts/differential/terminology.mjs`), and a disagreement is closed by fixing a fixture or the library, never by loosening the comparison: the default server moved three documents in and out of FALSE VALID (#104), and five FALSE VALIDs on main were incomplete fixtures (#20).
- A declared gap pinned by a characterization test reds when it closes, so rewrite that test in the same change, and never write "pinned by a test" without opening the test: three such claims had none (#58).
- `pnpm attw` stays `node scripts/attw.mjs`, never bare `attw` (`node_modules/.bin`, from the `@arethetypeswrong/cli` devDependency): the bare CLI exits 0 on a pack with no types (#49).
- A change under `src/` adds a changeset and a `CHANGELOG.md` `[Unreleased]` bullet. Pick `minor` for new capability or anything that withdraws or narrows working behaviour (a new write refusal does), `patch` only when every public observable is unchanged: two breaks shipped as `patch` (#111).
- A changeset's text becomes the permanent release body: keep its first sentence short, and keep out internal identifiers and any claim a sibling changeset makes stale. The release refused such notes and published nothing (#39, #100), and two stale claims nearly froze into a body (#67, #71).
- `README.md`, `docs-content/` and the `/** */` comments and string literals in `src/` carry no item identifiers, phase language, ADR numbers or private paths. Translate the line; never delete a doc comment to pass `pnpm check:no-internal-refs` (#31).
- npm refuses new `@cosyte/fhir` versions with a bare `E403` (0.0.11, 0.1.0) and accepted only the narrowed 0.0.10, and the cause is not settled. Keep `files` to the runtime artifacts and the README slim (#134), never rename or rescope the package (#55), read the version from `package.json`, and do not call a publish settled from one result (#107, #109) or failed from a 404 seconds after it (`documentation/agent-notes.md#publish-state-fhir-npm-name`).
