/** Types for `zip.mjs`. See `corpus.d.mts` for why these declarations are hand-written. */

export interface ZipEntry {
  readonly name: string;
  readonly flags: number;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
}

export declare class ZipError extends Error {
  constructor(message: string);
}

export declare function readCentralDirectory(buf: Buffer): ZipEntry[];
export declare function readEntry(buf: Buffer, entry: ZipEntry): Buffer;
export declare function extractNamed(buf: Buffer, names: readonly string[]): Map<string, Buffer>;
