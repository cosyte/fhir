# Examples

Small runnable programs, one per job the package does. Each one imports `@cosyte/fhir` by its
published name, so it runs against the built package exactly as a consumer installs it, prints what
it read, and checks its own output: a mismatch exits non-zero. Every resource they read is a
synthetic fixture already committed under `test/__fixtures__/`.

Build once, then run them all:

```bash
pnpm install
pnpm build
pnpm examples
```

| File                                             | What it shows                                                                                                                                      | Run                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [`read-and-validate.ts`](read-and-validate.ts)   | Read an Observation from JSON, keep the magnitude exactly as written (`120.0`), branch on its `value[x]` type, validate it, and write it back out. | `pnpm tsx examples/read-and-validate.ts`  |
| [`safe-to-summarize.ts`](safe-to-summarize.ts)   | Read the negation on a refuted allergy, a vaccine not given and a do-not-perform order, and see a resource with an unknown modifier refused.       | `pnpm tsx examples/safe-to-summarize.ts`  |
| [`json-and-xml.ts`](json-and-xml.ts)             | Read the same Observation from JSON and XML into equivalent models, write the XML back byte for byte, and see a DTD refused.                       | `pnpm tsx examples/json-and-xml.ts`       |
| [`bundles-and-ndjson.ts`](bundles-and-ndjson.ts) | Tell a transaction from a batch, resolve references inside a Bundle, and stream a Bulk Data NDJSON export with a malformed line isolated.          | `pnpm tsx examples/bundles-and-ndjson.ts` |

CI runs `pnpm typecheck:examples`, `pnpm lint:examples`, `pnpm examples` and `pnpm phi-scan:examples`
after `pnpm build` on every pull request, so an example that drifts from the package fails the build.
