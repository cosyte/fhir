import { describe, expect, it } from "vitest";

import { decimal, isPrimitiveType, PRIMITIVE_TYPES, validatePrimitiveValue } from "../src/index.js";

/**
 * The FHIR R4 primitive value-domain layer (validation layer 3, datatype half). Patterns are the
 * spec's own (datatypes.html); these cases pin the well-formed / malformed boundary and the
 * shape-vs-lexical distinction (`type-mismatch` vs `invalid`).
 */
describe("validatePrimitiveValue — R4 datatype value-domain", () => {
  it("recognizes the primitive type names", () => {
    expect(isPrimitiveType("date")).toBe(true);
    expect(isPrimitiveType("code")).toBe(true);
    expect(isPrimitiveType("HumanName")).toBe(false);
    expect(PRIMITIVE_TYPES).toContain("dateTime");
  });

  it("accepts well-formed date / dateTime / instant / time", () => {
    expect(validatePrimitiveValue("2013", "date")).toBe("ok");
    expect(validatePrimitiveValue("2013-06", "date")).toBe("ok");
    expect(validatePrimitiveValue("2013-06-08", "date")).toBe("ok");
    expect(validatePrimitiveValue("2013-06-08T09:30:10Z", "dateTime")).toBe("ok");
    expect(validatePrimitiveValue("2013-06-08T09:30:10-05:00", "dateTime")).toBe("ok");
    expect(validatePrimitiveValue("2015-02-07T13:28:17.239Z", "instant")).toBe("ok");
    expect(validatePrimitiveValue("13:28:17", "time")).toBe("ok");
  });

  it("rejects impossible dates and malformed times", () => {
    expect(validatePrimitiveValue("2013-13-40", "date")).toBe("invalid");
    expect(validatePrimitiveValue("2013-00-01", "date")).toBe("invalid");
    expect(validatePrimitiveValue("25:00:00", "time")).toBe("invalid");
    // instant requires a timezone; a bare local dateTime is not a valid instant.
    expect(validatePrimitiveValue("2015-02-07T13:28:17", "instant")).toBe("invalid");
  });

  it("enforces code / id / uri / oid / uuid / base64 lexical forms", () => {
    expect(validatePrimitiveValue("final", "code")).toBe("ok");
    expect(validatePrimitiveValue(" leading", "code")).toBe("invalid");
    expect(validatePrimitiveValue("two  spaces", "code")).toBe("invalid");
    expect(validatePrimitiveValue("abc-123.4", "id")).toBe("ok");
    expect(validatePrimitiveValue("has space", "id")).toBe("invalid");
    expect(validatePrimitiveValue("a".repeat(65), "id")).toBe("invalid");
    expect(validatePrimitiveValue("http://example.org/x", "uri")).toBe("ok");
    expect(validatePrimitiveValue("has space", "uri")).toBe("invalid");
    expect(validatePrimitiveValue("urn:oid:2.16.840.1.113883.6.1", "oid")).toBe("ok");
    expect(validatePrimitiveValue("2.16.840", "oid")).toBe("invalid");
    expect(validatePrimitiveValue("urn:uuid:c757873d-ec9a-4326-a141-556f43239520", "uuid")).toBe(
      "ok",
    );
    expect(validatePrimitiveValue("not-a-uuid", "uuid")).toBe("invalid");
    expect(validatePrimitiveValue("aGVsbG8=", "base64Binary")).toBe("ok");
    expect(validatePrimitiveValue("###", "base64Binary")).toBe("invalid");
  });

  it("validates the JSON-number family from exact lexical text (never a float)", () => {
    expect(validatePrimitiveValue(decimal("42"), "integer")).toBe("ok");
    expect(validatePrimitiveValue(decimal("-7"), "integer")).toBe("ok");
    expect(validatePrimitiveValue(decimal("1.5"), "integer")).toBe("invalid");
    expect(validatePrimitiveValue(decimal("0"), "unsignedInt")).toBe("ok");
    expect(validatePrimitiveValue(decimal("-1"), "unsignedInt")).toBe("invalid");
    expect(validatePrimitiveValue(decimal("1"), "positiveInt")).toBe("ok");
    expect(validatePrimitiveValue(decimal("0"), "positiveInt")).toBe("invalid");
    expect(validatePrimitiveValue(decimal("0.010"), "decimal")).toBe("ok");
    expect(validatePrimitiveValue(decimal("9223372036854775807"), "integer64")).toBe("ok");
  });

  it("distinguishes a wrong shape (type-mismatch) from a wrong value (invalid)", () => {
    // boolean datatype needs a JS boolean, not a string.
    expect(validatePrimitiveValue("true", "boolean")).toBe("type-mismatch");
    expect(validatePrimitiveValue(true, "boolean")).toBe("ok");
    // a numeric datatype needs a FhirDecimal, not a string.
    expect(validatePrimitiveValue("42", "integer")).toBe("type-mismatch");
    // a string datatype needs a string, not a decimal.
    expect(validatePrimitiveValue(decimal("42"), "string")).toBe("type-mismatch");
  });

  it("checks string / markdown for control chars and length", () => {
    expect(validatePrimitiveValue("hello world", "string")).toBe("ok");
    expect(validatePrimitiveValue("line1\nline2\tindented", "string")).toBe("ok");
    // A form-feed (\f) is a control char the FHIR string pattern forbids (only tab/CR/LF ok).
    expect(validatePrimitiveValue("bad\fchar", "string")).toBe("invalid");
    expect(validatePrimitiveValue("", "string")).toBe("invalid");
    expect(validatePrimitiveValue("# heading\n\ntext", "markdown")).toBe("ok");
  });

  it("says nothing (ok) about a non-primitive datatype — that is a structural concern", () => {
    expect(validatePrimitiveValue("anything", "HumanName")).toBe("ok");
  });
});
