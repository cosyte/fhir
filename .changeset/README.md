# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets). Changesets drives
the **version bump**, the **publish**, and the **release section in `CHANGELOG.md`** for
`@cosyte/fhir`: `config.json` names the `@changesets/cli/changelog` generator, so a release writes
its own version heading there from the changesets it consumed. So **the changeset summary is the
changelog entry**. Write it there for a reader of the package, and do not hand-edit `CHANGELOG.md`,
whose sections above `## Released before this file was generated` are generated output.

Add a changeset for every meaningful change:

```bash
pnpm changeset
```

The package is on the 0.1 line. While the version is below 1.0, every release is a **patch**,
including one that withdraws or narrows working behavior (a breaking change). A breaking change
must say so in its changeset: state what changed, and add a paragraph that opens with
`What a caller must change:` and says what a caller must do. The release readiness check in
`test/release-readiness.test.ts` refuses a breaking change declared `patch` without that paragraph,
and at 1.0 or above it refuses a breaking change at `patch` whatever the changeset says.

Keep the summary's first sentence short: it becomes the bullet in the public GitHub release notes,
and the release refuses a body it cannot publish rather than trimming it. Keep internal item
identifiers out of it, and do not start a line with a `#` heading, since the summary is indented
into the generated release section and such a line would render as a heading inside it.
