/**
 * Tests for scripts/attw.mjs, the wrapper that makes the `attw` publish gate report its own
 * failure.
 *
 * WHAT EACH GROUP PINS, AND WHY IT IS HERE:
 *
 *  1. THE UPSTREAM BEHAVIOUR THE WRAPPER EXISTS FOR. Bare `attw` prints "This package does not
 *     contain types." and exits 0. Without this case the rest of the file proves nothing: it is
 *     the demonstration that the OLD invocation (`attw --pack .`) really did hand `verify.sh` a
 *     0 over a tarball with no declarations. If a future `attw` upgrade fixes that exit code or
 *     rewords the sentence, this test reds, which is the point. A guard that silently stops
 *     matching is worse than no guard, and the sentence is the one thing in `attw.mjs` that
 *     depends on a string.
 *  2. That the wrapper turns each of those exit 0s into a failure.
 *  3. That the preflight catches a declared-but-missing artifact, which is the shape this
 *     package's build passes through on every run: `tsup` writes `dist/index.mjs` about two
 *     seconds before `dist/index.d.ts`.
 *  4. A NEGATIVE CONTROL. On a package whose tarball really does carry declarations, the wrapper
 *     is transparent: same exit status as `attw` itself, and green. A gate that only ever fails
 *     is not a gate, and a false red here costs every later run an hour.
 *  5. THE GATE'S MOST BASIC OBLIGATION, that a real `attw` failure still fails. Without it every
 *     other case here would pass on a wrapper that swallowed attw's own exit status, because net
 *     2 reds the untyped fixture regardless.
 *  6. The refusals that keep net 2 readable. Each argument and config route below was measured
 *     against this package's own `dist/` with the two `.d.ts` files deleted, and each one made
 *     the untyped sentence unreadable while attw exited 0: the exact false green this file
 *     exists to close.
 *
 * The fixtures are throwaway packages in a temp dir. Nothing here touches this repo's own
 * `dist/`, so the suite needs no build and cannot race one. `attw` is invoked with
 * `--no-definitely-typed` so the runs stay offline, which works because the wrapper forwards
 * arguments it does not refuse.
 *
 * SECURITY: every subprocess call is spawnSync with array args. No exec, no shell form.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const WRAPPER = join(REPO_ROOT, "scripts", "attw.mjs");
const ATTW_BIN = join(REPO_ROOT, "node_modules", ".bin", "attw");
const UNTYPED = "This package does not contain types.";
const OFFLINE = ["--no-definitely-typed"];
// Each case shells out to `attw --pack`, which runs a real `npm pack`. Two of those in one test
// comfortably exceeds this suite's 10s default.
const SPAWN_TIMEOUT = 60_000;

interface RunResult {
  code: number;
  out: string;
}

function run(bin: string, args: string[], cwd: string): RunResult {
  const r = spawnSync(bin, args, { cwd, encoding: "utf8", timeout: 120_000 });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** The OLD invocation this unit replaced: `attw --pack .`, straight to the CLI. */
const runAttw = (cwd: string, extra: string[] = []): RunResult =>
  run(ATTW_BIN, ["--pack", ".", ...OFFLINE, ...extra], cwd);
const runWrapper = (cwd: string, args: string[] = OFFLINE): RunResult =>
  run(process.execPath, [WRAPPER, ...args], cwd);

let root: string;

/** A package whose declaration file exists on disk but is left out of `files`. */
let typesNotPacked: string;
/** A package pointing at a `dist/` that was never built. */
let noBuild: string;
/** The shape of this package mid-build: JS bundles emitted, declarations not yet written. */
let midBuild: string;
/** A well-formed dual ESM/CJS package. The negative control. */
let wellFormed: string;
/** A package with a real attw problem: `require` resolves to ESM. */
let attwFails: string;
/** Declarations present, JS entry point missing. attw itself is green on this. */
let jsMissing: string;

function writePkg(dir: string, pkg: Record<string, unknown>, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
}

/** This package's own `exports` shape, so the mid-build fixture is not a strawman. */
function cosyteShapedPkg(name: string, files: string[]): Record<string, unknown> {
  return {
    name,
    version: "1.0.0",
    type: "module",
    main: "./dist/index.cjs",
    module: "./dist/index.mjs",
    types: "./dist/index.d.ts",
    exports: {
      ".": {
        import: { types: "./dist/index.d.ts", default: "./dist/index.mjs" },
        require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
      },
      "./package.json": "./package.json",
    },
    files,
  };
}

const JS_ESM = "export const a = 1;\n";
const JS_CJS = "module.exports.a = 1;\n";
const DTS = "export declare const a: number;\n";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "attw-gate-"));

  typesNotPacked = join(root, "types-not-packed");
  writePkg(
    typesNotPacked,
    {
      name: "attw-gate-fixture-unpacked",
      version: "1.0.0",
      main: "./index.js",
      types: "./index.d.ts",
      files: ["index.js"],
    },
    { "index.js": "module.exports = {};\n", "index.d.ts": DTS },
  );

  noBuild = join(root, "no-build");
  writePkg(noBuild, cosyteShapedPkg("attw-gate-fixture-nobuild", ["dist"]), {});

  // `tsup` emits the JS bundles first and the declarations later, so this is the state this
  // package's own `dist/` is in for roughly two seconds of every build.
  midBuild = join(root, "mid-build");
  writePkg(midBuild, cosyteShapedPkg("attw-gate-fixture-midbuild", ["dist"]), {
    "dist/index.mjs": JS_ESM,
    "dist/index.cjs": JS_CJS,
  });

  wellFormed = join(root, "well-formed");
  writePkg(
    wellFormed,
    {
      name: "attw-gate-fixture-wellformed",
      version: "1.0.0",
      type: "module",
      exports: {
        ".": {
          import: { types: "./index.d.ts", default: "./index.js" },
          require: { types: "./index.d.cts", default: "./index.cjs" },
        },
      },
      files: ["index.js", "index.d.ts", "index.cjs", "index.d.cts"],
    },
    { "index.js": JS_ESM, "index.d.ts": DTS, "index.cjs": JS_CJS, "index.d.cts": DTS },
  );

  // ESM-only, with no `require` condition: attw's strict profile reports CJSResolvesToESM and
  // exits non-zero of its own accord.
  attwFails = join(root, "attw-fails");
  writePkg(
    attwFails,
    {
      name: "attw-gate-fixture-problem",
      version: "1.0.0",
      type: "module",
      exports: { ".": { types: "./index.d.ts", default: "./index.js" } },
      files: ["index.js", "index.d.ts"],
    },
    { "index.js": JS_ESM, "index.d.ts": DTS },
  );

  jsMissing = join(root, "js-missing");
  writePkg(
    jsMissing,
    {
      name: "attw-gate-fixture-jsmissing",
      version: "1.0.0",
      main: "./dist/index.js",
      types: "./index.d.ts",
      files: ["index.d.ts"],
    },
    { "index.d.ts": DTS },
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the false green on the old invocation (`attw --pack .`)", () => {
  it(
    "reports an untyped pack and still exits 0 when the declarations were not packed",
    () => {
      const r = runAttw(typesNotPacked);
      expect(r.out).toContain(UNTYPED);
      // If this ever fails because the status is now non-zero, attw has fixed the early return
      // in getExitCode() and net 2 of scripts/attw.mjs is redundant. Read that file's header
      // before deleting anything.
      expect(r.code).toBe(0);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "reports an untyped pack and still exits 0 mid-build, with the JS emitted and no .d.ts",
    () => {
      const r = runAttw(midBuild);
      expect(r.out).toContain(UNTYPED);
      expect(r.code).toBe(0);
    },
    SPAWN_TIMEOUT,
  );
});

describe("scripts/attw.mjs", () => {
  it(
    "fails when the tarball carries no types, where attw exits 0",
    () => {
      const r = runWrapper(typesNotPacked);
      expect(r.out).toContain(UNTYPED);
      expect(r.code).not.toBe(0);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "fails, naming the missing declarations, on the mid-build state attw calls untyped",
    () => {
      const r = runWrapper(midBuild);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("./dist/index.d.ts");
      expect(r.out).toContain("./dist/index.d.cts");
      expect(r.out).toContain("missing");
      expect(r.out).toContain(UNTYPED);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "fails, naming the file, when a declared artifact was never built",
    () => {
      const r = runWrapper(noBuild);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("./dist/index.d.ts");
      expect(r.out).toContain("missing");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "fails on a declared artifact that exists but is empty",
    () => {
      const truncated = join(root, "truncated");
      writePkg(truncated, cosyteShapedPkg("attw-gate-fixture-truncated", ["dist"]), {
        "dist/index.mjs": JS_ESM,
        "dist/index.cjs": JS_CJS,
        "dist/index.d.ts": DTS,
        "dist/index.d.cts": "",
      });
      const r = runWrapper(truncated);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("./dist/index.d.cts");
      expect(r.out).toContain("empty");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "does not claim attw would have said 'untyped' when only JS is missing",
    () => {
      // Measured: with the declarations intact, bare attw reports no problems and exits 0 on
      // this fixture. The preflight still reds it, but must not tell the reader something about
      // attw's behaviour that is false for this case.
      const bare = runAttw(jsMissing);
      expect(bare.out).toContain("No problems found");
      expect(bare.code).toBe(0);
      const r = runWrapper(jsMissing);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("./dist/index.js");
      expect(r.out).not.toContain(UNTYPED);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "still fails when attw itself fails, with attw's own status",
    () => {
      const bare = runAttw(attwFails);
      expect(bare.code).not.toBe(0);
      expect(bare.out).not.toContain(UNTYPED);
      const wrapped = runWrapper(attwFails);
      expect(wrapped.code).toBe(bare.code);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "is transparent on a package that really does ship types",
    () => {
      const bare = runAttw(wellFormed);
      const wrapped = runWrapper(wellFormed);
      expect(bare.out).not.toContain(UNTYPED);
      expect(wrapped.code).toBe(bare.code);
      expect(wrapped.code).toBe(0);
    },
    SPAWN_TIMEOUT,
  );
});

describe("the refusals that keep the post-check readable", () => {
  it.each([
    ["--quiet", ["--quiet"]],
    ["-q", ["-q"]],
    ["--format json", ["--format", "json"]],
    ["-f json", ["-f", "json"]],
    ["--format=json", ["--format=json"]],
    ["--config-path", ["--config-path", "other.json"]],
  ])("refuses %s", (_name, extra) => {
    const r = runWrapper(typesNotPacked, [...OFFLINE, ...extra]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("attw gate");
  });

  it(
    "each refused argument really does blind bare attw over an untyped pack",
    () => {
      // The refusals are only justified if these routes hide the sentence. Both measured here
      // against the fixture whose tarball carries no declarations.
      const quiet = runAttw(typesNotPacked, ["--quiet"]);
      expect(quiet.out).not.toContain(UNTYPED);
      expect(quiet.code).toBe(0);

      const json = runAttw(typesNotPacked, ["--format", "json"]);
      expect(json.out).not.toContain(UNTYPED);
      expect(json.code).toBe(0);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "refuses a .attw.json that sets quiet or format",
    () => {
      const dir = join(root, "config-blinded");
      writePkg(
        dir,
        {
          name: "attw-gate-fixture-configblind",
          version: "1.0.0",
          main: "./index.js",
          types: "./index.d.ts",
          files: ["index.js"],
        },
        {
          "index.js": "module.exports = {};\n",
          "index.d.ts": DTS,
          ".attw.json": JSON.stringify({ quiet: true }),
        },
      );
      // Bare attw takes the config and goes silent: exit 0 over an untyped pack.
      const bare = runAttw(dir);
      expect(bare.code).toBe(0);
      expect(bare.out).not.toContain(UNTYPED);

      const r = runWrapper(dir);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain(".attw.json");
    },
    SPAWN_TIMEOUT,
  );
});
