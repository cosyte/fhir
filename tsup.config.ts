import { cosyteTsup } from "@cosyte/tsup-config";

/**
 * tsup build for @cosyte/fhir, dual ESM + CJS + `.d.ts` from the shared @cosyte/tsup-config standard
 * (ES2023, Node platform, `.mjs`/`.cjs` out-extensions). Matches the `exports` map in package.json.
 *
 * Two entry points. `arbitraries` (the `@cosyte/fhir/arbitraries` subpath) imports the library by
 * its own package name, and the build leaves that import in place, so the subpath loads the same
 * `dist/index` a consumer's own `import "@cosyte/fhir"` loads: one `FhirDecimal` class, not a second
 * bundled copy. The plugin below is what keeps it: tsup bundles any import that `paths` in
 * `tsconfig.json` maps, even one it is told is external, and `paths` maps the package's own name
 * to `src/index.ts` for the type checker. `fast-check` is the subpath's optional peer dependency
 * and stays external too; nothing `src/index.ts` reaches imports it.
 *
 * The published files leave out whitespace (`minifyWhitespace`) and nothing else. Most of a cold
 * import is the engine compiling `dist/index.mjs`, which takes time in step with the file's size,
 * so a smaller file imports faster. Names and syntax stay as written: a stack trace into the
 * published file names the package's own functions, at a column on a long line rather than on a
 * line of its own. No source map is published (`files` in `package.json` leaves the maps out).
 * Turning the option off restores the spaced-out files.
 */
export default cosyteTsup({
  entry: { index: "src/index.ts", arbitraries: "src/arbitraries/index.ts" },
  external: ["@cosyte/fhir", "fast-check"],
  minifyWhitespace: true,  esbuildPlugins: [
    {
      name: "keep-own-package-external",
      setup(build) {
        build.onResolve({ filter: /^@cosyte\/fhir$/ }, (args) => ({
          path: args.path,
          external: true,
        }));
      },
    },
  ],
});
