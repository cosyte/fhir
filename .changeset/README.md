# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets). Changesets drives
the **version bump** and **publish** for `@cosyte/fhir`; the human-readable release notes live in
`CHANGELOG.md` (`changelog` generation is disabled in `config.json`).

Add a changeset for every meaningful change:

```bash
pnpm changeset
```

While the version is below 1.0, pick **minor** for new public capability or for any change that
withdraws or narrows working behaviour (a breaking change), and call the break out in the changeset
and in `CHANGELOG.md`. Pick **patch** only for a fix that leaves every public observable identical,
or for a change that does not reach the published package at all.
