/** Types for `stryker-changed-lines.mjs`, hand-written as for the other `.mjs` scripts. */

import type { Changes, readChanges } from "@cosyte/script-utils/changes";

export interface LineSpan {
  readonly start: { readonly line: number };
  readonly end: { readonly line: number };
}

export interface ChangedLinesIgnorer {
  shouldIgnore(path: unknown): string | undefined;
}

export declare const BASE_VARIABLE: "MUTATE_CHANGED_LINES_BASE";
export declare const IGNORER_NAME: "changed-lines";

export declare function touchesChangedLine(loc: LineSpan, lines: ReadonlySet<number>): boolean;

export declare function changedLinesByPath(
  change: Pick<Changes, "root" | "files">,
): Map<string, Set<number>>;

export declare function createChangedLinesIgnorer(input: {
  readonly changes: () => Map<string, Set<number>>;
  readonly base: string;
}): ChangedLinesIgnorer;

export declare function ignorerFromEnvironment(
  env?: Record<string, string | undefined>,
  read?: typeof readChanges,
): ChangedLinesIgnorer;

export declare const strykerPlugins: readonly {
  readonly kind: "Ignore";
  readonly name: "changed-lines";
  readonly value: ChangedLinesIgnorer;
}[];
