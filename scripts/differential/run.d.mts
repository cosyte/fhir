/** Types for `run.mjs`. See `corpus.d.mts` for why these declarations are hand-written. */

import type { Record_, Summary } from "./compare.d.mts";
import type { Declaration, ResolvedDocument } from "./corpus.d.mts";
import type { OracleIdentity } from "./oracle.d.mts";
import type { RunRecord } from "./record.d.mts";
import type { ResolvedTerminologyInputs } from "./terminology.d.mts";
import type { ReachReport, UsCoreDocument, UsCoreRow } from "./uscore.d.mts";

export interface OwnIssue {
  readonly severity: string;
  readonly location: string;
  readonly code?: string;
  readonly constraint?: string;
}

export type OwnAnswer =
  | { readonly ok: true; readonly issues: readonly OwnIssue[]; readonly parseRefused: boolean }
  | { readonly ok: false; readonly reason: string };

/** What the harness asks this library for one document: the declared profiles' texts, or none. */
export interface OwnOptions {
  readonly profiles?: readonly string[];
}

export interface RunComparisonInput {
  readonly jar: string;
  readonly identity: OracleIdentity;
  readonly declaration: Declaration;
  readonly terminology: ResolvedTerminologyInputs;
  readonly ourFindings: (text: string, options?: OwnOptions) => OwnAnswer;
  readonly only?: readonly string[];
  readonly scope?: string;
  readonly batchSize?: number;
  readonly timeoutMs?: number;
  readonly exec?: (file: string, args: readonly string[], options: unknown) => unknown;
  readonly read?: (path: string) => string;
  readonly location?: { readonly repoRoot?: string; readonly documentsRoot?: string };
  /** The rows the US Core reach report covers; the committed newly evaluated rows when omitted. */
  readonly rows?: readonly UsCoreRow[];
}

export interface ComparisonOutcome {
  readonly records: readonly Record_[];
  readonly summary: Summary;
  readonly runRecord: RunRecord;
  readonly resolved: readonly ResolvedDocument[];
  /** The US Core pass, when the comparison resolved at least one US Core document. */
  readonly usCore?: {
    readonly documents: readonly UsCoreDocument[];
    readonly report: ReachReport;
  };
}

export declare const BATCH_SIZE: number;
export declare const BATCH_TIMEOUT_MS: number;

export declare function runComparison(input: RunComparisonInput): ComparisonOutcome;
export declare function corpusSummaryLines(declaration: Declaration): string[];
