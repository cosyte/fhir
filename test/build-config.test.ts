import { describe, expect, it } from "vitest";

import config from "../tsup.config.js";

/** The options of `tsup.config.ts` this file reads. */
interface BuildOptions {
  readonly minify?: boolean | "terser";
  readonly minifyWhitespace?: boolean;
  readonly minifyIdentifiers?: boolean;
  readonly minifySyntax?: boolean;
}

/**
 * How the published files are written. Most of a cold import of the package is the engine compiling
 * `dist/index.mjs`, and that time follows the size of the file, so the build leaves the whitespace
 * out of it: the file is smaller and compiles faster. It strips whitespace only. Every function and
 * variable keeps its name and the code its syntax, so a stack trace into the published file still
 * names the package's own functions, on a long line. No source map is published (`files` in
 * `package.json` leaves the maps out).
 */
const options = config as unknown as BuildOptions;

describe("the published build", () => {
  it("strips whitespace", () => {
    expect(options.minifyWhitespace).toBe(true);
  });

  it("keeps every name and the syntax as written", () => {
    expect(options.minify ?? false).toBe(false);
    expect(options.minifyIdentifiers ?? false).toBe(false);
    expect(options.minifySyntax ?? false).toBe(false);
  });
});
