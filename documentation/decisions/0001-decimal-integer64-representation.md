# 0001 — `decimal` / `integer64` internal representation: string-backed, lexically exact

- **Status:** Accepted
- **Date:** 2026-07-15

## Context

FHIR has two numeric primitives that a naive JavaScript implementation silently corrupts:

- **`decimal`.** The FHIR spec makes trailing-zero precision *significant*: it states plainly that
  "the precision in the presentation of the number SHALL be preserved" and that, e.g., **`0.010` is
  a different value from `0.01`** — the trailing zero carries meaning (it records the precision of a
  measurement). FHIR also forbids representing `decimal` as an IEEE-754 double and warns
  implementers that a standard JSON parser is *non-conformant* for FHIR decimals, because
  `JSON.parse` maps the JSON number to a 64-bit float. In JavaScript, `JSON.parse('{"v":0.010}').v`
  is `0.01` — the trailing zero is gone before any of our code runs, and `0.1 + 0.2 !== 0.3`. For
  clinical data (a lab result, a dose, a rate) this is silent data corruption that can change the
  meaning of a value.
- **`integer64`** (added in R5). Its range is the full signed 64-bit integer,
  `-9223372036854775808 … 9223372036854775807`, which exceeds JavaScript's
  `Number.MAX_SAFE_INTEGER` (`2^53 - 1 = 9007199254740991`). Precisely because of this, FHIR's JSON
  format encodes `integer64` as a **JSON string**, not a JSON number. Parsing it through `Number`
  loses low-order digits above 2^53.

Both hazards share one root cause: routing the value through the JS `number` type at any point
destroys information irrecoverably. Because the model shape and the JSON codec are built next
(Phase 1), the representation has to be decided now — retrofitting exact precision after a `number`
has leaked into the model is a rewrite, not a patch.

## Decision

`decimal` and `integer64` are **string-backed** primitives whose source of truth is the **exact
lexical text** as it appeared on the wire. They **never** pass through the JavaScript `number` (or
`parseFloat`/`Number`/`+x`) type — not on read, not on compare, not on write.

- The canonical stored form is the original literal string (`"0.010"`, `"1e3"` normalized per spec
  rules on emit only, `"9223372036854775807"`). Read preserves it byte-for-byte; the trailing zero
  survives.
- Typed accessors are provided instead of coercion: `.toString()` returns the exact literal;
  `integer64` exposes a lazy `BigInt` view for arithmetic; `decimal` gets a dedicated
  compare/arithmetic surface (a minimal, in-repo big-decimal — see ADR 0002's zero-dependency
  posture) rather than any `number`-based math. Full decimal arithmetic is deferred with the rest of
  the parser; **the representation commitment is what P0 fixes**.
- Equality is precision-aware: the model distinguishes *lexical* equality (`0.010` ≠ `0.01`) from
  *numeric* equality (`0.010` == `0.01`) and exposes both. The default `equals` for a `decimal`
  preserves the FHIR distinction (lexical), so round-tripping never quietly normalizes precision.
- **Consequence for the codec (ADR 0003 / Phase 1):** a blind `JSON.parse` is non-conformant for
  FHIR. The JSON reader must capture the raw token text for `decimal` (a reviver cannot, because it
  only sees the already-parsed `number`) — so the codec uses a tokenizing/streaming read that hands
  `decimal` and `integer64` fields their literal source string. This is recorded here so the codec is
  not designed around `JSON.parse`.

## Consequences

- **No silent precision loss.** `0.010` stays `0.010`; a 64-bit identifier stays exact. This is the
  whole point — a parser that mis-reads a dose or an identifier can harm someone.
- **A wrapper type, not a JS number, is the public surface** for these two primitives. Consumers pay
  a small ergonomic cost (`.toString()` / `.toBigInt()` / compare helpers instead of `+`), bought
  deliberately in exchange for correctness. This is documented as an intentional API choice.
- **The JSON codec cannot use `JSON.parse` for the whole document** — it needs raw-literal access for
  `decimal`. That cost is real and is accepted here so it is not a surprise in Phase 1.
- **`integer64` reads/writes as a JSON string** (per FHIR), consistent whether it arrives from R5 or
  is round-tripped; the read-tolerance for R5 in ADR 0004 inherits this representation unchanged.
- We take on a small in-repo big-decimal for `decimal` comparison/arithmetic rather than a
  dependency (ADR 0002) — bounded, and scoped to what FHIR decimals require.
