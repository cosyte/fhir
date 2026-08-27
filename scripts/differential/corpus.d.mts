/**
 * Types for `corpus.mjs`. The implementation is plain ESM so `node scripts/differential.mjs` runs
 * with no loader; this file is what lets `test/differential-corpus.test.ts` type-check against it.
 */

export interface CorpusAcquisition {
  readonly kind: "in-tree" | "files" | "archive";
  readonly root?: string;
  readonly baseUrl?: string;
  readonly url?: string;
  readonly format?: string;
  readonly sha256?: string;
  readonly bytes?: number;
}

export interface CorpusRecord {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly licence: string;
  readonly origin: string;
  readonly authored: "self" | "third-party";
  readonly acquisition: CorpusAcquisition;
  readonly licenceText: string | null;
  readonly notice: string | null;
}

export interface DocumentRecord {
  readonly id: string;
  readonly corpus: string;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly exclude?: string;
  readonly note?: string;
}

export interface Declaration {
  readonly schemaVersion: 1;
  readonly comparedFloor: number;
  /** The document ids `pnpm differential:determinism` compares twice, declared not derived. */
  readonly determinismSubset?: readonly string[];
  readonly corpora: readonly CorpusRecord[];
  readonly documents: readonly DocumentRecord[];
}

export interface ResolvedDocument {
  readonly document: DocumentRecord;
  readonly file: string;
  readonly text: string;
  readonly bytes: Buffer;
}

export interface Exclusion {
  readonly id: string;
  readonly corpus: string;
  readonly path: string;
  readonly reason: string;
}

export interface LocationOptions {
  readonly repoRoot?: string;
  readonly documentsRoot?: string;
}

export interface ResolveCorpusOptions extends LocationOptions {
  /** Narrows what is handed back. Never narrows what is verified. */
  readonly only?: readonly string[] | ReadonlySet<string>;
}

export declare const REPO_ROOT: string;
export declare const DECLARATION_PATH: string;
export declare const DOCUMENTS_ROOT: string;
export declare const LICENCES_ROOT: string;

export declare class CorpusError extends Error {
  constructor(message: string);
}

export declare function sha256(buf: Buffer | Uint8Array | string): string;
export declare function parseDeclaration(text: string, where?: string): Declaration;
export declare function loadDeclaration(file?: string): Declaration;
export declare function corpusOf(declaration: Declaration, document: DocumentRecord): CorpusRecord;
export declare function declaredDocuments(declaration: Declaration): readonly DocumentRecord[];
export declare function includedDocuments(declaration: Declaration): readonly DocumentRecord[];
export declare function exclusions(declaration: Declaration): readonly Exclusion[];
export declare function determinismSubset(declaration: Declaration): readonly DocumentRecord[];
export declare function documentLocation(
  declaration: Declaration,
  document: DocumentRecord,
  options?: LocationOptions,
): string;
export declare function readDeclaredDocument(
  declaration: Declaration,
  document: DocumentRecord,
  options?: LocationOptions,
): ResolvedDocument;
export declare function resolveCorpus(
  declaration: Declaration,
  options?: ResolveCorpusOptions,
): readonly ResolvedDocument[];
export declare function provenanceLine(declaration: Declaration, document: DocumentRecord): string;
export declare function shortfall(compared: number, floor: number): string | null;
