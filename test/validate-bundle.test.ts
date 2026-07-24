import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { collectBundleIssues, parseResource, validateResource } from "../src/index.js";
import { nth } from "./_util.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

function codes(json: string): string[] {
  return collectBundleIssues(parseResource(json).resource).map((i) => i.code);
}

describe("collectBundleIssues: Bundle integrity findings", () => {
  it("flags a RESTful fullUrl whose id disagrees with resource.id (error)", () => {
    const issues = collectBundleIssues(
      parseResource(
        '{"resourceType":"Bundle","type":"collection","entry":[' +
          '{"fullUrl":"https://ex/Patient/1","resource":{"resourceType":"Patient","id":"2"}}]}',
      ).resource,
    );
    const mismatch = nth(issues, 0);
    expect(mismatch.code).toBe("FULLURL_ID_MISMATCH");
    expect(mismatch.severity).toBe("error");
    expect(mismatch.expression).toBe("Bundle.entry[0].fullUrl");
  });

  it("does NOT flag a urn:uuid fullUrl against any resource.id (logical, unconstrained)", () => {
    expect(
      codes(
        '{"resourceType":"Bundle","type":"collection","entry":[' +
          '{"fullUrl":"urn:uuid:abc","resource":{"resourceType":"Patient","id":"2"}}]}',
      ),
    ).not.toContain("FULLURL_ID_MISMATCH");
  });

  it("does NOT flag a matching RESTful fullUrl", () => {
    expect(
      codes(
        '{"resourceType":"Bundle","type":"collection","entry":[' +
          '{"fullUrl":"https://ex/Patient/1","resource":{"resourceType":"Patient","id":"1"}}]}',
      ),
    ).toEqual([]);
  });

  it("warns (never fatal) on a relative reference naming no Bundle entry", () => {
    const { resource } = parseResource(fixture("bundle.json"));
    const issues = collectBundleIssues(resource);
    // Only the Patient.managingOrganization → Organization/2 is unresolvable; Observation.subject
    // → Patient/1 resolves against the Patient entry.
    const unresolved = issues.filter((i) => i.code === "REFERENCE_UNRESOLVED");
    expect(unresolved).toHaveLength(1);
    expect(nth(unresolved, 0).severity).toBe("warning");
    expect(nth(unresolved, 0).expression).toContain("managingOrganization");
  });

  it("warns on a #fragment naming an absent contained resource", () => {
    expect(
      codes(
        '{"resourceType":"Bundle","type":"collection","entry":[' +
          '{"resource":{"resourceType":"Observation","id":"o","status":"final",' +
          '"subject":{"reference":"#ghost"}}}]}',
      ),
    ).toContain("REFERENCE_UNRESOLVED");
  });

  it("does NOT warn on an external absolute/logical reference (not a local miss)", () => {
    expect(
      codes(
        '{"resourceType":"Bundle","type":"collection","entry":[' +
          '{"resource":{"resourceType":"Observation","id":"o","status":"final",' +
          '"subject":{"reference":"https://other-server/fhir/Patient/99"}}}]}',
      ),
    ).not.toContain("REFERENCE_UNRESOLVED");
  });

  it("flags a contained reference cycle as an error, without looping", () => {
    const issues = collectBundleIssues(
      parseResource(
        '{"resourceType":"Bundle","type":"collection","entry":[' +
          '{"resource":{"resourceType":"Observation","id":"root","contained":[' +
          '{"resourceType":"Observation","id":"a","hasMember":[{"reference":"#b"}]},' +
          '{"resourceType":"Observation","id":"b","hasMember":[{"reference":"#a"}]}]}}]}',
      ).resource,
    );
    const cycle = issues.filter((i) => i.code === "CONTAINED_CYCLE");
    expect(cycle).toHaveLength(1);
    expect(nth(cycle, 0).severity).toBe("error");
    expect(nth(cycle, 0).expression).toBe("Bundle.entry[0].resource.contained");
  });

  it("returns nothing for a clean transaction Bundle", () => {
    expect(codes(fixture("bundle-transaction.json"))).toEqual([]);
  });

  it("returns nothing for a non-Bundle resource", () => {
    expect(codes('{"resourceType":"Patient","id":"1"}')).toEqual([]);
  });
});

describe("validateResource: Bundle-integrity layer wiring (Phase 9)", () => {
  it("surfaces the bundle findings through validateResource and fails on an error", () => {
    const { resource } = parseResource(
      '{"resourceType":"Bundle","type":"collection","entry":[' +
        '{"fullUrl":"https://ex/Patient/1","resource":{"resourceType":"Patient","id":"2"}}]}',
    );
    const result = validateResource(resource);
    expect(result.issues.some((i) => i.code === "FULLURL_ID_MISMATCH")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("a warning-only Bundle finding does not by itself make the resource invalid", () => {
    const { resource } = parseResource(
      '{"resourceType":"Bundle","type":"collection","entry":[' +
        '{"resource":{"resourceType":"Patient","id":"1",' +
        '"managingOrganization":{"reference":"Organization/absent"}}}]}',
    );
    const result = validateResource(resource);
    const bundleIssues = result.issues.filter((i) => i.code === "REFERENCE_UNRESOLVED");
    expect(bundleIssues).toHaveLength(1);
    // REFERENCE_UNRESOLVED is a warning; nothing here is an error.
    expect(result.issues.every((i) => i.severity !== "error")).toBe(true);
    expect(result.valid).toBe(true);
  });
});
