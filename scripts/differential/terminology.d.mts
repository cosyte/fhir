/**
 * Types for `terminology.mjs`. See `corpus.d.mts` for why these declarations are hand-written.
 */

export interface PinnedTerminologyInput {
  readonly path: string;
  readonly sha256: string;
  readonly bytes?: number;
}

export interface TerminologyInputs {
  readonly source: "none" | "pinned";
  readonly server: string;
  readonly cache: string;
  readonly pinned: readonly PinnedTerminologyInput[];
}

export interface ResolvedTerminologyInputs extends TerminologyInputs {
  readonly pinned: readonly Required<PinnedTerminologyInput>[];
  /** SHA-256 over the resolved record, so a changed input changes the printed line. */
  readonly digest: string;
}

export interface ResolveOptions {
  readonly repoRoot?: string;
  readonly read?: (path: string) => Buffer;
  readonly where?: string;
}

export declare const NO_TERMINOLOGY: string;
export declare const TX_SERVER_OPTION: string;
export declare const TX_CACHE_OPTION: string;
export declare const DEFAULT_TX_SERVER: string;
export declare const TERMINOLOGY_SOURCES: readonly string[];
export declare const TERMINOLOGY_INPUTS: TerminologyInputs;

export declare class TerminologyError extends Error {
  constructor(message: string);
}

export declare function parseTerminologyInputs(
  value: unknown,
  where?: string,
): TerminologyInputs;
export declare function resolveTerminologyInputs(
  inputs?: unknown,
  options?: ResolveOptions,
): ResolvedTerminologyInputs;
export declare function terminologyArgs(
  resolved: TerminologyInputs,
  options?: { readonly repoRoot?: string },
): string[];
export declare function auditTerminologyArgv(
  argv: readonly string[],
  resolved?: TerminologyInputs,
  options?: { readonly repoRoot?: string },
): { readonly server: string; readonly cache: string };
export declare function formatTerminologyInputs(resolved: ResolvedTerminologyInputs): string;
