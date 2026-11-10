// Types for bench/shapes.mjs, so the scaling gate under test/perf builds its inputs from the same
// code the benchmarks do.

/** 1024. */
export declare const KIB: number;
/** A vital-signs Observation of about 1.3 KiB, the same length for every index. */
export declare function observation(i: number): string;
/** A transaction Bundle of `entries` entries, one entry to a line. */
export declare function transactionBundle(i: number, entries: number): string;
/** A searchset page of `matches` Observations with their Patients included. */
export declare function searchsetBundle(i: number, matches: number): string;
/** A Patient with 8 of each repeating element, a deep extension tree and `contained` resources. */
export declare function containedPatient(i: number, contained: number): string;
/** A DiagnosticReport carrying a base64 PDF of `bytes` bytes. */
export declare function reportWithAttachment(i: number, bytes: number): string;
