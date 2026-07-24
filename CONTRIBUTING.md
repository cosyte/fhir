# Contributing to @cosyte/fhir

Thanks for considering a contribution. This library grows faster when real integration teams surface
FHIR quirks from the servers and EHRs they connect to, and contribute profiles for the systems they
work with.

> **Note:** `@cosyte/fhir` is a **pre-alpha scaffold**: the parser itself is not built yet. The
> most useful early contributions are grounded, de-identified real-world FHIR samples and issues
> that sharpen the roadmap. See the phased plan in the meta-repo's `operations/roadmaps/fhir.md`.

## Filing an issue

Before filing, please:

1. Search existing issues. Chances are your quirk is already logged.
2. Reduce to the smallest reproducing FHIR resource. Use **synthetic identifiers only, no PHI**.
   We keep fixtures in the public repo.
3. Include the FHIR version (R4 `4.0.1` is the modeled target; R5 / DSTU2 are read-tolerance only),
   the source server/EHR, and what you expected vs. what happened.

## Opening a PR

1. Fork and branch from `main`.
2. Run the full pipeline locally before pushing. See [Dev setup](#dev-setup).
3. If your change is user-visible, add a bullet under the `## [Unreleased]` section of
   [CHANGELOG.md](./CHANGELOG.md), and add a Changeset (`pnpm changeset`, pick **patch** on the
   pre-alpha `0.0.x` ladder).
4. Keep PRs focused: one logical change per PR. Large refactors should start as an issue for
   discussion.
5. Write a descriptive commit message. Imperative mood (`feat(codec): ...`, `fix(model): ...`) is
   encouraged but not enforced.

## Dev setup

The project uses **pnpm** (not npm or yarn). All commands run from the repo root.

```bash
pnpm install
pnpm build       # dual ESM + CJS + .d.ts via tsup
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint, --max-warnings=0
pnpm test        # vitest run
```

## Architecture decisions

Substantive design choices are recorded as ADRs under
[`documentation/decisions/`](documentation/decisions/). Read the four bootstrap ADRs before working
on the model or codec. They bind the primitive representation, the FHIRPath posture, the XML scope,
and the version strategy. New binding choices get a new ADR in the same format (context / decision /
consequences).

## PHI

This is healthcare software. **Never commit realistic PHI**: fixtures are synthetic or properly
de-identified, and logs redact. A vendor quirk is encoded only when a real de-identified resource
grounds it, never invented.
