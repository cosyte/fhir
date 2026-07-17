import { describe, expect, it } from "vitest";

import { parseReference } from "../src/index.js";

describe("parseReference (references.html)", () => {
  it("classifies a fragment reference and extracts the anchor", () => {
    expect(parseReference("#p1")).toEqual({ raw: "#p1", kind: "fragment", id: "p1" });
  });

  it("classifies a relative reference with type and id", () => {
    expect(parseReference("Patient/123")).toEqual({
      raw: "Patient/123",
      kind: "relative",
      type: "Patient",
      id: "123",
    });
  });

  it("extracts a version from a relative _history suffix", () => {
    expect(parseReference("Observation/9/_history/2")).toEqual({
      raw: "Observation/9/_history/2",
      kind: "relative",
      type: "Observation",
      id: "9",
      version: "2",
    });
  });

  it("classifies an absolute RESTful URL and extracts the tail", () => {
    const parsed = parseReference("https://ehr.example.org/fhir/Patient/abc");
    expect(parsed.kind).toBe("absolute");
    expect(parsed.type).toBe("Patient");
    expect(parsed.id).toBe("abc");
  });

  it("extracts a version from an absolute URL with _history", () => {
    const parsed = parseReference("https://ehr.example.org/fhir/Observation/9/_history/7");
    expect(parsed).toMatchObject({ kind: "absolute", type: "Observation", id: "9", version: "7" });
  });

  it("classifies an absolute non-RESTful URL as absolute without type/id", () => {
    const parsed = parseReference("https://example.org/");
    expect(parsed.kind).toBe("absolute");
    expect(parsed.type).toBeUndefined();
    expect(parsed.id).toBeUndefined();
  });

  it("classifies a scheme-only absolute URL as absolute without type/id", () => {
    const parsed = parseReference("https://");
    expect(parsed.kind).toBe("absolute");
    expect(parsed.type).toBeUndefined();
  });

  it("classifies a urn: as logical, not absolute", () => {
    expect(parseReference("urn:uuid:2c9e8f10-1").kind).toBe("logical");
    expect(parseReference("urn:oid:1.2.3").kind).toBe("logical");
  });

  it("classifies a bare token as logical", () => {
    expect(parseReference("just-a-token").kind).toBe("logical");
  });
});
