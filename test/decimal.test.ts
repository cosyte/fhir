import { describe, expect, it } from "vitest";

import { decimal, FhirDecimal, wouldLosePrecisionAsDouble } from "../src/index.js";

describe("FhirDecimal — lexical precision (ADR 0001)", () => {
  it("preserves the exact lexical text, trailing zeros included", () => {
    expect(decimal("0.010").toString()).toBe("0.010");
    expect(decimal("70.0").toString()).toBe("70.0");
    expect(decimal("1e3").toString()).toBe("1e3");
    expect(decimal("-3.14").toString()).toBe("-3.14");
  });

  it("never routes through a JS number (0.1 + 0.2 stays exact as text)", () => {
    // A naive parser would make these equal; the lexical form keeps them distinct.
    expect(decimal("0.010").toString()).not.toBe(decimal("0.01").toString());
  });

  it("rejects non-numeric text at the factory boundary", () => {
    expect(() => decimal("abc")).toThrow(TypeError);
    expect(() => decimal("")).toThrow(TypeError);
    expect(() => decimal("01")).toThrow(TypeError); // JSON forbids leading zeros
    expect(() => decimal("1.")).toThrow(TypeError);
    expect(() => decimal("NaN")).toThrow(TypeError);
  });

  describe("equals — precision-sensitive (the FHIR default)", () => {
    it("treats 0.010 and 0.01 as different (trailing zero is significant)", () => {
      expect(decimal("0.010").equals(decimal("0.01"))).toBe(false);
    });

    it("treats identical precision as equal", () => {
      expect(decimal("1.50").equals(decimal("1.50"))).toBe(true);
    });

    it("distinguishes 1.0 from 1.00", () => {
      expect(decimal("1.0").equals(decimal("1.00"))).toBe(false);
    });
  });

  describe("equalsValue — quantity-only", () => {
    it("treats 0.010 and 0.01 as the same quantity", () => {
      expect(decimal("0.010").equalsValue(decimal("0.01"))).toBe(true);
    });

    it("treats 1e2 and 100 as the same quantity", () => {
      expect(decimal("1e2").equalsValue(decimal("100"))).toBe(true);
    });

    it("separates genuinely different quantities", () => {
      expect(decimal("0.011").equalsValue(decimal("0.01"))).toBe(false);
    });
  });

  describe("toBigInt", () => {
    it("returns the exact value for an integer-valued decimal beyond 2^53", () => {
      expect(decimal("9223372036854775807").toBigInt()).toBe(9223372036854775807n);
    });

    it("handles exponent forms that are integer-valued", () => {
      expect(decimal("1e3").toBigInt()).toBe(1000n);
      expect(decimal("1.5e1").toBigInt()).toBe(15n);
    });

    it("handles a positive-scale value that is nonetheless integer-valued", () => {
      expect(decimal("10.0").toBigInt()).toBe(10n);
      expect(decimal("1.00").toBigInt()).toBe(1n);
    });

    it("throws for a non-integer-valued decimal rather than truncating", () => {
      expect(() => decimal("1.5").toBigInt()).toThrow(RangeError);
    });
  });

  describe("toNumber — the one deliberately-lossy path", () => {
    it("converts to a JS number when the caller accepts the loss", () => {
      expect(decimal("0.5").toNumber()).toBe(0.5);
    });
  });

  it("falls back to string equality if raw is somehow non-numeric (defensive)", () => {
    const bad = new FhirDecimal("not-a-number");
    expect(bad.equals(bad)).toBe(true);
    expect(bad.equalsValue(new FhirDecimal("other"))).toBe(false);
    expect(() => bad.toBigInt()).toThrow(RangeError);
  });
});

describe("wouldLosePrecisionAsDouble", () => {
  it("flags trailing-zero precision loss", () => {
    expect(wouldLosePrecisionAsDouble("0.010")).toBe(true);
    expect(wouldLosePrecisionAsDouble("70.0")).toBe(true);
  });

  it("flags values with more significant digits than a double keeps", () => {
    expect(wouldLosePrecisionAsDouble("9223372036854775807")).toBe(true);
    expect(wouldLosePrecisionAsDouble("0.12345678901234567890")).toBe(true);
  });

  it("does not flag values a double round-trips exactly", () => {
    expect(wouldLosePrecisionAsDouble("0.5")).toBe(false);
    expect(wouldLosePrecisionAsDouble("42")).toBe(false);
    expect(wouldLosePrecisionAsDouble("-3.25")).toBe(false);
  });

  it("returns false for non-numeric text (nothing to protect)", () => {
    expect(wouldLosePrecisionAsDouble("abc")).toBe(false);
  });
});
