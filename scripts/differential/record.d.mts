/** Types for `record.mjs`. See `corpus.d.mts` for why these declarations are hand-written. */

import type { Record_, Summary } from "./compare.d.mts";
import type { OracleIdentity } from "./oracle.d.mts";
import type { ResolvedTerminologyInputs } from "./terminology.d.mts";

export interface RunRecordDocument {
  readonly id: string;
  readonly status: string;
  readonly compared: boolean;
  readonly clean: boolean;
  readonly violation: boolean;
  readonly oracleErrors: number;
  readonly ourErrors: number;
  readonly terminology: number;
  readonly terminologyErrors: number;
}

export interface RunRecordTotals {
  readonly compared: number;
  readonly clean: number;
  readonly violations: number;
  readonly unusable: number;
  readonly excluded: number;
  readonly terminologyDocuments: number;
  readonly terminologyFindings: number;
  readonly terminologyDeltas: number;
  readonly meetsFloor: boolean;
}

export interface RunRecord {
  readonly recordVersion: number;
  readonly oracle: {
    readonly release: string;
    readonly artifact: string;
    readonly bytes: number;
    readonly sha256: string;
  };
  readonly terminology: {
    readonly source: string;
    readonly server: string;
    readonly cache: string;
    readonly digest: string;
    readonly pinned: readonly { readonly path: string; readonly bytes: number; readonly sha256: string }[];
  };
  readonly corpus: {
    readonly declared: number;
    readonly excluded: number;
    readonly floor: number;
    readonly scope: string;
    readonly documents: readonly string[];
    readonly corpora: readonly {
      readonly id: string;
      readonly version: string;
      readonly licence: string;
    }[];
  };
  readonly totals: RunRecordTotals;
  readonly documents: readonly RunRecordDocument[];
}

export interface CorpusFacts {
  readonly declared?: number;
  readonly excluded?: number;
  readonly floor?: number;
  readonly scope?: string;
  readonly documents?: readonly string[];
  readonly corpora?: readonly { readonly id: string; readonly version: string; readonly licence: string }[];
}

export interface BuildRunRecordInput {
  readonly oracle?: Partial<OracleIdentity>;
  readonly terminology?: Partial<ResolvedTerminologyInputs>;
  readonly corpus?: CorpusFacts;
  readonly records?: readonly Record_[];
  readonly summary?: Partial<Summary>;
}

export interface DeterminismVerdict {
  readonly demonstrated: boolean;
  readonly reason: string;
  readonly differences: readonly string[];
}

export declare const RUN_RECORD_VERSION: number;
export declare const NOT_DEMONSTRATED: string;
export declare const DEMONSTRATED: string;

export declare function canonicalJson(value: unknown): string;
export declare function runRecordDigest(record: unknown): string;
export declare function buildRunRecord(input: BuildRunRecordInput): RunRecord;
export declare function formatRunRecord(record: RunRecord): string[];
export declare function determinismRefusal(reason: string): DeterminismVerdict;
export declare function differencesBetween(first: unknown, second: unknown): string[];
export declare function determinismVerdict(first: unknown, second: unknown): DeterminismVerdict;
export declare function formatDeterminismVerdict(verdict: DeterminismVerdict): string[];
export declare function exitCodeForDeterminism(verdict: DeterminismVerdict): number;
