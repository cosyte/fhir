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
 */
export default cosyteTsup({
  entry: { index: "src/index.ts", arbitraries: "src/arbitraries/index.ts" },
  external: ["@cosyte/fhir", "fast-check"],
  esbuildPlugins: [
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
