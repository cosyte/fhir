import { expect } from "vitest";

import {
  FhirSerializeError,
  SERIALIZE_ERROR_CODES,
  serializeResource,
  type FhirComplex,
  type FhirNode,
} from "../src/index.js";

/**
 * Assert a value is present and return it narrowed, a lint-clean stand-in for the non-null
 * assertion operator (`!`), which the shared ESLint config forbids. Use for array/`Map` reads under
 * `noUncheckedIndexedAccess` where the test logically knows the element exists.
 */
export function req<T>(value: T | undefined | null, label = "value"): T {
  expect(value, `${label} should be defined`).not.toBeUndefined();
  if (value === undefined || value === null) throw new Error(`${label} is nullish`);
  return value;
}

/** `req(arr[i])` with a helpful label. */
export function nth<T>(arr: readonly T[], i: number): T {
  return req(arr[i], `index ${String(i)}`);
}

/**
 * A copy of a model with the XML reader's foreign-vocabulary marks taken off, so a test can read
 * what the model holds through `serializeResource`, which refuses a marked model. The copy is a
 * probe of the model, never a route a caller has: no public helper removes a mark.
 */
export function withoutForeignMarks(node: FhirComplex): FhirComplex {
  const { foreignNamespace: _foreign, foreignRoot: _root, ...rest } = node;
  return {
    ...rest,
    properties: node.properties.map((p) => ({ ...p, value: unmarkedNode(p.value) })),
    ...(node.duplicates === undefined
      ? {}
      : { duplicates: node.duplicates.map((p) => ({ ...p, value: unmarkedNode(p.value) })) }),
  };
}

/** {@link withoutForeignMarks} for any node. */
function unmarkedNode(node: FhirNode): FhirNode {
  if (node.kind === "complex") return withoutForeignMarks(node);
  if (node.kind === "list") return { ...node, items: node.items.map(unmarkedNode) };
  const { foreignNamespace: _foreign, ...rest } = node;
  return node.extension === undefined
    ? rest
    : { ...rest, extension: node.extension.map(withoutForeignMarks) };
}

/**
 * What `serializeResource` writes for the model with its foreign-vocabulary marks taken off, after
 * asserting what it does with the marks on: a model carrying none is written to the same string,
 * and a model carrying one is refused on a foreign-vocabulary code. For tests that pinned the JSON
 * writer's output for a model the XML reader marked, which that writer now refuses.
 */
export function jsonOfModel(node: FhirComplex): string {
  const unmarked = withoutForeignMarks(node);
  const json = serializeResource(unmarked);
  if (JSON.stringify(unmarked) === JSON.stringify(node)) {
    expect(serializeResource(node)).toBe(json);
    return json;
  }
  let refused: unknown;
  try {
    serializeResource(node);
  } catch (err) {
    refused = err;
  }
  expect(refused).toBeInstanceOf(FhirSerializeError);
  expect([
    SERIALIZE_ERROR_CODES.UNSERIALIZABLE_FOREIGN_ROOT,
    SERIALIZE_ERROR_CODES.UNSERIALIZABLE_FOREIGN_NAMESPACE,
  ]).toContain((refused as FhirSerializeError).code);
  return json;
}
