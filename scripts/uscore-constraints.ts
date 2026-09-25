#!/usr/bin/env tsx
/**
 * Run every projected US Core constraint through the bounded FHIRPath subset and print, per row,
 * whether the subset evaluates it or which construct declines it, then per-version totals.
 *
 *     pnpm uscore:constraints                        # the report
 *     pnpm uscore:constraints --write-expectation    # also rewrite the committed expectation
 *
 * The rows are `test/__data__/uscore-constraints.json`; the classification and what `evaluated`
 * means are `scripts/uscore-classify.ts`. Every line is built from the projection and the engine's
 * own subset, never from an instance, so nothing printed can carry a patient value.
 *
 * @packageDocumentation
 */

import { writeFileSync } from "node:fs";

import {
  classifyProjection,
  EXPECTATION_PATH,
  loadProjection,
  renderExpectation,
  reportLines,
} from "./uscore-classify.js";

const rows = classifyProjection(loadProjection());
process.stdout.write(`${reportLines(rows).join("\n")}\n`);
if (process.argv.includes("--write-expectation")) {
  writeFileSync(EXPECTATION_PATH, renderExpectation(rows));
}
