---
"@cosyte/fhir": patch
---

Make the `attw` publish gate report its own failure, instead of exiting 0 on a tarball that carries
no type declarations (`ATTW-FALSE-GREEN-PORT`, the shipped `terminology` fix ported here).

`package.json` ran `attw --pack .`. `@arethetypeswrong/cli@0.18.4`'s `dist/getExitCode.js` opens
with `if (!analysis.types) return 0`, returning before `analysis.problems` is read, so the CLI
printed "This package does not contain types." and handed its caller a **0**. An untyped npm package
is legal, so for `attw` that is a description rather than a problem; for a package that ships `.d.ts`
files it means the declarations were not in the tarball, which is a broken publish reported as a
pass. A false red costs an hour; **a false green merges.** No `--profile`, `--ignore-rules` or config
setting can reach past that early return, so the remedy could never be a stricter invocation.

**Reproduced on this package with zero concurrency**, at `edb75df`: `rm -rf dist && pnpm attw` and
`rm -f dist/index.d.ts dist/index.d.cts && pnpm attw` both printed the sentence and exited 0. The
second is the state a real build passes through: `tsup` emits the JS bundles in one pass and the
declarations in a later one, so every build here has an interval where `dist/` holds
`index.mjs`/`index.cjs` and no `.d.ts`. Measured over four clean builds, as the mtime of
`dist/index.d.ts` minus the mtime of `dist/index.mjs`: **1.86 s, 2.03 s, 2.29 s, 2.46 s**. Anything
landing `attw` inside that interval (a second build, a `pnpm clean` in the same working tree)
produces the exit 0.

**Concurrency only supplies the condition, so this is deliberately not answered with a lock, a lease
or a build queue** (meta-repo ADR 0015). The defect is that the gate could not say its own inputs
were missing, and it should be able to say that whatever removed them. The shipped `terminology` fix
needed no coordination machinery either, and neither does this one.

`attw` is now `node scripts/attw.mjs`, with **two nets that catch different things**:

1. A structural **preflight**. Every relative artifact path `package.json` promises (`main`,
   `module`, `types`, `typings`, and every string leaf of `exports`) must exist and be non-empty
   before `attw` runs. This is the net that catches the build window above, and it names the missing
   file rather than leaving the reader to infer it. It deliberately does not claim the exit-0
   counterfactual unless a declaration file is among the casualties: with the declarations intact and
   only JS missing, `attw` reports no problems at all and still exits 0, which is a different
   silence.
2. A **post-check**. If `attw` still reports an untyped package, fail. The preflight structurally
   cannot see this case, because the declarations can be present on disk and still be excluded from
   the tarball by `files` or `.npmignore`. No instance of that has been observed in this repo; it is
   precisely what `attw --pack` exists to catch, and the point is that it catches it silently.

The post-check matches a printed string, so **the routes that hide that string are refused rather
than tolerated**. Four were measured here against a `dist/` with both `.d.ts` files deleted, each
exiting 0 with the sentence unreadable: `--quiet`, `--format json`, a `./.attw.json` setting `quiet`
(`readConfig()` applies it after argv), and `--config-path` pointing at that same config from
elsewhere. The refusal is **by option name, wholesale, not by value**: `--format table-flipped`
prints the sentence and blinds nothing, and is refused anyway, which is a deliberate trade against
adding value-parsing to the guard. Every other argument is forwarded, so `--profile node16`,
`--ignore-rules` and `--no-definitely-typed` still work.

`test/scripts/attw-gate.test.ts` pins both nets against the real binary, **including the upstream
exit 0 itself**, so an `attw` upgrade that fixes the exit code or rewords the sentence reds the suite
instead of letting the net go quietly slack. It also holds a negative control (the wrapper is
transparent, with `attw`'s own status, on a package that really does ship types) and asserts that a
genuine `attw` failure still fails: a gate that only ever fails is not a gate, and one that swallows
the status is not one either. Reverting `scripts/attw.mjs` to the bare invocation reds **12 of its 17
cases**; the 5 that stay green are exactly those asserting upstream behaviour and the negative
controls.

**No library code changed and no public API moved.** This is a packaging gate only.
