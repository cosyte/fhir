// Types for bench/budgets.mjs, so a test reads the budgets tables the bench-reading workflow prints.

import type { ReadingBody } from "@cosyte/bench";

/** The budgets tables, as Markdown, for the body of a reading. */
export declare function budgetsMarkdown(reading: ReadingBody): string;
