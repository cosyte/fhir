# Contributing to @cosyte/fhir

The org-wide guide applies here: https://github.com/cosyte/.github/blob/main/CONTRIBUTING.md. This
file adds only what is specific to @cosyte/fhir.

## What helps most

FHIR quirks from the servers and EHRs you connect to, each shown with a synthetic document: a
resource the reader, the validator, or the safety readout gets wrong. Use fabricated identifiers and
values only; fixtures live in this public repository.

## Filing an issue

Say which FHIR version the document claims. R4 (`4.0.1`) is the modeled target; R5 and DSTU2
documents are read, but they are not validated against their own definitions. Name the server or
EHR that produced it, and say what you expected beside what happened.

## Before you open a pull request

- Run the full gate in [AGENTS.md](AGENTS.md), in order. It adds to the org guide's five commands:
  the format check, the PHI scan, coverage, the type-export check, the fuzz tier, the examples, and
  the dash and public-surface checks. CI also runs a differential against the HL7 reference
  validator, which needs `java` and the pinned `validator_cli.jar`.
- Add a changeset (`pnpm changeset`). The Changesets changelog generator is on in this repository,
  so the changeset summary is the `CHANGELOG.md` entry; do not edit `CHANGELOG.md` by hand. While
  the version is below 1.0, pick `minor` for new capability or for any change that withdraws or
  narrows working behavior (a new write refusal does), and `patch` only when every public observable
  is unchanged.
- Use no em or en dashes (U+2014, U+2013) anywhere: in tracked files, the PR title, the PR body, or
  any commit message. CI checks all four (`.github/workflows/no-emdash.yml`), and
  `pnpm check:no-emdash` runs the file half locally. Rewrite with a period, colon, comma, or
  parentheses.

## Architecture decisions

The choices that bind the model and the codecs are recorded under
[`documentation/decisions/`](documentation/decisions/): the primitive representation, the FHIRPath
posture, the XML scope, and the version strategy. Read them before working on the model or a codec;
a new binding choice gets a new record in the same format (context, decision, consequences).
