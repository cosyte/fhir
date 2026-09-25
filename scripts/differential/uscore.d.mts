/** Types for `uscore.mjs`. See `corpus.d.mts` for why these declarations are hand-written. */

import type { Record_ } from "./compare.d.mts";
import type { CorpusRecord, Declaration, DocumentRecord, LocationOptions } from "./corpus.d.mts";

export interface IndexedProfile {
  readonly id: string;
  readonly url: string;
  readonly type: string;
  readonly baseDefinition?: string;
  readonly snapshot: readonly unknown[];
  readonly text: string;
}

export interface ProfileIndex {
  readonly byUrl: ReadonlyMap<string, IndexedProfile>;
}

export interface UsCoreRow {
  readonly version: string;
  readonly profile: string;
  readonly type: string;
  readonly element: string;
  readonly path: string;
  readonly sliceName?: string;
  readonly key: string;
}

export type DeclaredProfiles =
  | { readonly ok: true; readonly urls: readonly string[]; readonly profiles: readonly string[] }
  | { readonly ok: false; readonly reason: string };

export interface OwnIssueLike {
  readonly code?: string;
  readonly constraint?: string;
  readonly location: string;
  readonly severity: string;
}

export type OwnAnswerLike =
  | {
      readonly ok: true;
      readonly issues: readonly OwnIssueLike[];
      readonly parseRefused?: boolean;
    }
  | { readonly ok: false; readonly reason: string };

export interface UsCoreDocument {
  readonly id: string;
  readonly version: string;
  readonly text: string;
  readonly index: ProfileIndex;
  readonly profiles: readonly string[] | undefined;
  readonly ours: OwnAnswerLike;
  readonly record: Record_;
}

export interface ReachingDocument {
  readonly id: string;
  readonly answer: string;
  readonly violation: boolean;
  readonly agrees: boolean;
  readonly variants: readonly string[];
}

export interface RowResult {
  readonly row: UsCoreRow;
  readonly reached: boolean;
  readonly reason?: string;
  readonly declaring: number;
  readonly documents: readonly ReachingDocument[];
}

export interface ReachReport {
  readonly rows: readonly RowResult[];
  readonly comparedDocuments: number;
}

export declare const PACKAGES_KIND: string;
export declare const US_CORE_PACKAGE: string;
export declare const EXAMPLE_DIRECTORY: string;
export declare const PACKAGE_FILE: string;
export declare const PROJECTION_PATH: string;
export declare const CLASSIFICATION_PATH: string;
export declare const UCUM_RULE: {
  readonly version: string;
  readonly key: string;
  readonly variant: string;
};
export declare const ROW_ANSWER: {
  readonly VIOLATED: string;
  readonly SATISFIED: string;
  readonly UNCHECKED: string;
  readonly NOT_EVALUATED: string;
  readonly NOT_VALIDATED: string;
};
export declare const NOT_REACHED: {
  readonly SLICE_SCOPED: string;
  readonly NO_COMPARED_DOCUMENT: string;
};

export declare function usCoreIg(version: string): string;
export declare function isPackageCorpus(corpus: CorpusRecord | undefined): boolean;
export declare function packageCorpora(declaration: Declaration): readonly CorpusRecord[];
export declare function packageEntryOf(document: DocumentRecord): string | null;
export declare function packageLocation(
  corpus: CorpusRecord,
  version: string,
  options?: LocationOptions,
): string;
export declare function packageMismatch(
  corpus: CorpusRecord,
  version: string,
  buf: Buffer,
): string | null;
export declare function readVerifiedPackage(
  corpus: CorpusRecord,
  version: string,
  options?: LocationOptions & { readonly read?: (path: string) => Buffer },
): Buffer;
export declare function packageEntries(tgz: Buffer): Map<string, Buffer>;
export declare function profileIndex(entries: ReadonlyMap<string, Buffer>): ProfileIndex;
export declare function loadPackage(
  corpus: CorpusRecord,
  version: string,
  options?: LocationOptions,
): ProfileIndex;
export declare function declaredProfiles(
  text: string,
  version: string,
  index: ProfileIndex,
): DeclaredProfiles;
export declare function newlyEvaluatedRows(
  projection: unknown,
  classification: unknown,
): UsCoreRow[];
export declare function loadNewlyEvaluatedRows(options?: {
  readonly read?: (path: string) => string;
  readonly projectionPath?: string;
  readonly classificationPath?: string;
}): UsCoreRow[];
export declare function isSliceScoped(row: UsCoreRow): boolean;
export declare function carriesRow(url: string, row: UsCoreRow, index: ProfileIndex): boolean;
export declare function anchorOccurrences(
  resource: unknown,
  row: UsCoreRow,
): { readonly complex: number; readonly primitive: number };
export declare function wasValidated(ours: OwnAnswerLike | undefined): boolean;
export declare function rowAnswer(
  issues: readonly OwnIssueLike[],
  row: UsCoreRow,
  occurrences: { readonly complex: number; readonly primitive: number },
): string;
export declare function isDecided(answer: string): boolean;
export declare function reachReport(input: {
  readonly rows: readonly UsCoreRow[];
  readonly documents: readonly UsCoreDocument[];
}): ReachReport;
export declare function agreeingCount(result: RowResult): number;
export declare function ucumExercised(report: ReachReport): string[];
export declare function ucumShortfall(report: ReachReport): string | null;
export declare function formatReachReport(report: ReachReport): string[];
export declare function formatUsCoreDocuments(
  records: readonly Record_[],
  ids: readonly string[],
): string[];
