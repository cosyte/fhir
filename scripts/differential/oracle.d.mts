/** Types for `oracle.mjs`. See `corpus.d.mts` for why these declarations are hand-written. */

export interface OracleIssue {
  readonly severity: string;
  readonly location: string;
}

export interface OracleIdentity {
  readonly release: string;
  readonly artifact: string;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export type OracleOutput =
  | { readonly ok: true; readonly byName: Map<string, OracleIssue[]>; readonly unattributed?: number }
  | { readonly ok: false; readonly reason: string };

export interface RunOptions {
  readonly exec?: (file: string, args: readonly string[], options: unknown) => unknown;
  readonly read?: (path: string) => string;
  readonly timeoutMs?: number;
  readonly fhirVersion?: string;
  readonly ig?: string;
}

export declare const ORACLE_RELEASE: string;
export declare const ORACLE_DOWNLOAD_URL: string;
export declare const US_CORE_IG: string;
export declare const FHIR_VERSION: string;
export declare const OUTCOME_FILE_EXTENSION: string;

export declare class OracleError extends Error {
  constructor(message: string);
}

export declare function oracleIdentity(
  jarPath: string,
  options?: { readonly release?: string },
): OracleIdentity;
export declare function formatOracleIdentity(identity: OracleIdentity): string;
export declare function attributeOutcome(
  outcome: unknown,
  stagedNames: readonly string[],
): string | null;
export declare function parseOracleOutput(
  text: string,
  stagedNames: readonly string[],
): OracleOutput;
export declare function oracleArgs(
  jar: string,
  files: readonly string[],
  outputPath: string,
  options?: RunOptions,
): string[];
export declare function runOracleBatch(
  jar: string,
  stagedFiles: readonly string[],
  outputPath: string,
  options?: RunOptions,
): OracleOutput;
