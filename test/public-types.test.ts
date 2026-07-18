/**
 * FHIR-P11 type-level tier (roadmap Phase 11 — "type-level (`expect-type`) tests on the public
 * surface").
 *
 * The public API's *types* are part of its contract: the discriminated unions a consumer switches on
 * (`FhirNode.kind`, `ObservationValue.type`, `ReferenceKind`), the precision-preserving value type
 * (`PrimitiveValue` is never a JS `number`), and the value-free diagnostic shape (`FhirIssue`) are
 * all promises this library makes at compile time. These assertions are checked by `tsc --noEmit`
 * (the `typecheck` gate runs over `test/**`), so a breaking change to a public type fails CI even if
 * every runtime test still passes.
 *
 * `expectTypeOf(...).toEqualTypeOf<T>()` is an exact (bidirectional) type equality; `.toExtend<T>()`
 * is a one-way assignability check.
 */

import { describe, expectTypeOf, it } from "vitest";

import {
  decimal,
  parseReference,
  parseResource,
  readObservationValue,
  serializeResource,
  validateResource,
} from "../src/index.js";
import type {
  FatalCode,
  FhirCodecError,
  FhirComplex,
  FhirDecimal,
  FhirIssue,
  FhirNode,
  IssueCode,
  IssueSeverity,
  ObservationValue,
  ObservationValueType,
  ParsedReference,
  PrimitiveValue,
  ReadResult,
  ReferenceKind,
  ValidationResult,
} from "../src/index.js";

describe("public types: the codec surface", () => {
  it("parseResource accepts text and returns a ReadResult", () => {
    expectTypeOf(parseResource).returns.toEqualTypeOf<ReadResult>();
    // A string is an accepted input (the parameter is a `string | RawJson` superset).
    expectTypeOf<string>().toExtend<Parameters<typeof parseResource>[0]>();
  });

  it("ReadResult carries an immutable model plus a readonly, value-free issues array", () => {
    expectTypeOf<ReadResult["resource"]>().toEqualTypeOf<FhirComplex>();
    expectTypeOf<ReadResult["issues"]>().toEqualTypeOf<readonly FhirIssue[]>();
  });

  it("FhirIssue is exactly { code; severity; expression } — a location, never a value", () => {
    expectTypeOf<FhirIssue>().toEqualTypeOf<{
      readonly code: IssueCode;
      readonly severity: IssueSeverity;
      readonly expression: string;
    }>();
    // Severity is the recoverable subset of the R4 set (a warning/info is never fatal).
    expectTypeOf<IssueSeverity>().toEqualTypeOf<"warning" | "information">();
  });

  it("serializeResource maps a model back to text", () => {
    expectTypeOf(serializeResource).parameter(0).toExtend<FhirComplex>();
    expectTypeOf(serializeResource).returns.toEqualTypeOf<string>();
  });
});

describe("public types: precision preservation (ADR 0001 — never a JS number)", () => {
  it("PrimitiveValue is string | boolean | FhirDecimal — a decimal is never a `number`", () => {
    expectTypeOf<PrimitiveValue>().toEqualTypeOf<string | boolean | FhirDecimal>();
    // The load-bearing negative: a JS number is NOT assignable to a primitive value.
    expectTypeOf<number>().not.toExtend<PrimitiveValue>();
  });

  it("decimal() builds a FhirDecimal whose stringification is lossless", () => {
    expectTypeOf(decimal).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(decimal).returns.toEqualTypeOf<FhirDecimal>();
    expectTypeOf<ReturnType<FhirDecimal["toString"]>>().toEqualTypeOf<string>();
  });
});

describe("public types: the discriminated unions a consumer switches on", () => {
  it("FhirNode is a `kind`-discriminated union of complex | list | primitive", () => {
    expectTypeOf<FhirNode["kind"]>().toEqualTypeOf<"complex" | "list" | "primitive">();
    // Narrowing on the discriminant yields the branch shape.
    expectTypeOf<Extract<FhirNode, { kind: "complex" }>>().toEqualTypeOf<FhirComplex>();
  });

  it("Observation.value[x] is discriminated by an eleven-way `type` suffix", () => {
    expectTypeOf(readObservationValue).returns.toEqualTypeOf<ObservationValue | undefined>();
    expectTypeOf<ObservationValue["type"]>().toEqualTypeOf<ObservationValueType>();
    // The 11-way choice includes the non-numeric branches — reading is never number-only.
    expectTypeOf<
      "Quantity" | "CodeableConcept" | "String" | "Boolean"
    >().toExtend<ObservationValueType>();
  });

  it("ReferenceKind is the four-way relative | absolute | logical | fragment set", () => {
    expectTypeOf<ReferenceKind>().toEqualTypeOf<"fragment" | "relative" | "absolute" | "logical">();
    expectTypeOf(parseReference).returns.toEqualTypeOf<ParsedReference>();
    expectTypeOf<ParsedReference["kind"]>().toEqualTypeOf<ReferenceKind>();
  });
});

describe("public types: validation & the typed fatal", () => {
  it("validateResource(resource, options?) returns a ValidationResult", () => {
    expectTypeOf(validateResource).parameter(0).toEqualTypeOf<FhirComplex>();
    expectTypeOf(validateResource).returns.toEqualTypeOf<ValidationResult>();
    expectTypeOf<ValidationResult["valid"]>().toEqualTypeOf<boolean>();
    expectTypeOf<ValidationResult["toOperationOutcome"]>().toEqualTypeOf<() => FhirComplex>();
  });

  it("FhirCodecError carries a registered FatalCode and a value-free location", () => {
    expectTypeOf<FhirCodecError>().toExtend<Error>();
    expectTypeOf<FhirCodecError["code"]>().toEqualTypeOf<FatalCode>();
    expectTypeOf<FhirCodecError["offset"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<FhirCodecError["expression"]>().toEqualTypeOf<string | undefined>();
    // The depth-bound guard (P11) is part of the fatal union.
    expectTypeOf<"MAX_DEPTH_EXCEEDED">().toExtend<FatalCode>();
  });
});
