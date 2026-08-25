/** Types for `compare.mjs`. See `corpus.d.mts` for why these declarations are hand-written. */

import type { Exclusion } from "./corpus.d.mts";

export interface Finding {
  readonly severity: string;
  readonly location: string;
  readonly code?: string;
  readonly messageId?: string;
}

export type OracleAnswer =
  | { readonly ok: true; readonly issues: readonly Finding[] }
  | { readonly ok: false; readonly reason: string };

export type OwnAnswer =
  | { readonly ok: true; readonly issues: readonly Finding[]; readonly parseRefused: boolean }
  | { readonly ok: false; readonly reason: string };

export interface CompareInput {
  readonly id: string;
  readonly oracle: OracleAnswer;
  readonly ours: OwnAnswer;
}

export interface Record_ {
  readonly id: string;
  readonly status: string;
  readonly compared: boolean;
  readonly clean: boolean;
  readonly violation: boolean;
  readonly detail: string;
  readonly oracleErrors?: number;
  readonly oracleTotal?: number;
  readonly ourErrors?: number;
  readonly ourTotal?: number;
  readonly delta?: number;
  readonly oracleFindings?: readonly Finding[];
  readonly ourFindings?: readonly Finding[];
}

export interface Summary {
  readonly declared: number;
  readonly compared: number;
  readonly clean: number;
  readonly violations: readonly Record_[];
  readonly unusable: readonly Record_[];
  readonly exclusions: readonly Exclusion[];
  readonly floor: number;
  readonly meetsFloor: boolean;
}

export declare const ERRORISH: ReadonlySet<string>;
export declare const STATUS: {
  readonly AGREE: string;
  readonly FALSE_VALID: string;
  readonly SPURIOUS_ERROR: string;
  readonly SAFE_REFUSAL: string;
  readonly NO_ORACLE_OUTCOME: string;
  readonly NO_OWN_FINDINGS: string;
};

export declare function compareDocument(input: CompareInput): Record_;
export declare function summarize(input: {
  readonly records: readonly Record_[];
  readonly exclusions?: readonly Exclusion[];
  readonly floor: number;
}): Summary;
export declare function formatRecord(record: Record_): string;
export declare function formatExclusions(exclusions: readonly Exclusion[]): string[];
export declare function formatSummary(summary: Summary, identityLine: string): string[];
export declare function exitCodeFor(summary: Summary): number;
