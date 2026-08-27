/** Types for `compare.mjs`. See `corpus.d.mts` for why these declarations are hand-written. */

import type { Exclusion } from "./corpus.d.mts";

export interface Finding {
  readonly severity: string;
  readonly location: string;
  readonly code?: string;
  readonly messageId?: string;
  /** The code system `messageId` is drawn from, which is what the terminology class keys on. */
  readonly messageSystem?: string;
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
  /** How many of the oracle's findings were attributable to terminology resolution. */
  readonly terminology?: number;
  /** How many of those carried an error or fatal severity. */
  readonly terminologyErrors?: number;
  readonly oracleFindings?: readonly Finding[];
  readonly ourFindings?: readonly Finding[];
  readonly terminologyFindings?: readonly Finding[];
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
  readonly terminologyDocuments: number;
  readonly terminologyFindings: number;
  readonly terminologyDeltas: number;
}

export declare const ERRORISH: ReadonlySet<string>;
export declare const STATUS: {
  readonly AGREE: string;
  readonly FALSE_VALID: string;
  readonly SPURIOUS_ERROR: string;
  readonly SAFE_REFUSAL: string;
  readonly TERMINOLOGY_DELTA: string;
  readonly NO_ORACLE_OUTCOME: string;
  readonly NO_OWN_FINDINGS: string;
};
export declare const TERMINOLOGY_CLASS: string;
export declare const TX_ISSUE_TYPE_SYSTEM: string;
export declare const TERMINOLOGY_ISSUE_CODES: ReadonlySet<string>;
export declare const TERMINOLOGY_MESSAGE_ID_RE: RegExp;

export declare function isTerminologyFinding(finding: unknown): boolean;
export declare function classifyFinding(finding: unknown): string | null;
export declare function compareDocument(input: CompareInput): Record_;
export declare function summarize(input: {
  readonly records: readonly Record_[];
  readonly exclusions?: readonly Exclusion[];
  readonly floor: number;
}): Summary;
export declare function formatRecord(record: Record_): string;
export declare function formatExclusions(exclusions: readonly Exclusion[]): string[];
export declare function formatSummary(
  summary: Summary,
  identityLine: string,
  terminologyLine?: string,
): string[];
export declare function exitCodeFor(summary: Summary): number;
