import { describe, expect, it } from "vitest";

import {
  buildBundleIndex,
  containedIndex,
  hasContainedCycle,
  MAX_REFERENCE_DEPTH,
  parseResource,
  resolveReference,
} from "../src/index.js";

const bundleJson =
  '{"resourceType":"Bundle","type":"collection","entry":[' +
  '{"fullUrl":"urn:uuid:1","resource":{"resourceType":"Patient","id":"p1"}},' +
  '{"fullUrl":"https://ex.org/fhir/Observation/9","resource":{"resourceType":"Observation","id":"9","status":"final"}}]}';

describe("resolveReference: the four reference forms", () => {
  const { resource } = parseResource(bundleJson);
  const index = buildBundleIndex(resource);

  it("resolves an absolute reference by fullUrl and by its RESTful tail", () => {
    expect(resolveReference("https://ex.org/fhir/Observation/9", { bundle: index }).status).toBe(
      "resolved",
    );
    // Absolute URL with a different host but matching Type/id tail resolves via the tail index.
    expect(resolveReference("https://other/fhir/Observation/9", { bundle: index }).status).toBe(
      "resolved",
    );
  });

  it("resolves a relative reference against the Bundle by Type/id", () => {
    const res = resolveReference("Patient/p1", { bundle: index });
    expect(res.status).toBe("resolved");
  });

  it("resolves a logical (urn:uuid) reference by exact fullUrl", () => {
    expect(resolveReference("urn:uuid:1", { bundle: index }).status).toBe("resolved");
    // A urn not in the bundle is external, not a local miss.
    expect(resolveReference("urn:uuid:absent", { bundle: index }).status).toBe("external");
  });

  it("a relative reference to a missing entry is unresolved (a local miss)", () => {
    expect(resolveReference("Patient/absent", { bundle: index }).status).toBe("unresolved");
  });

  it("resolves a versioned relative reference (drops the _history suffix) against the entry", () => {
    expect(resolveReference("Patient/p1/_history/3", { bundle: index }).status).toBe("resolved");
  });

  it("a relative reference with no bundle context is external", () => {
    expect(resolveReference("Patient/p1", {}).status).toBe("external");
  });

  it("an absolute reference with no matching entry is external, never a false unresolved", () => {
    expect(resolveReference("https://elsewhere/fhir/Device/7", { bundle: index }).status).toBe(
      "external",
    );
    expect(resolveReference("https://elsewhere/not-restful", {}).status).toBe("external");
  });

  it("resolves fragments against contained, including the bare `#` root", () => {
    const { resource: obs } = parseResource(
      '{"resourceType":"Observation","id":"o","contained":[' +
        '{"resourceType":"Patient","id":"c1"}],"subject":{"reference":"#c1"}}',
    );
    const contained = containedIndex(obs);
    expect(resolveReference("#c1", { contained }).status).toBe("resolved");
    expect(resolveReference("#", { contained }).status).toBe("resolved");
    expect(resolveReference("#missing", { contained }).status).toBe("unresolved");
    // A fragment with no contained context cannot resolve.
    expect(resolveReference("#c1", {}).status).toBe("unresolved");
  });

  it("returns the resolved target node", () => {
    const res = resolveReference("urn:uuid:1", { bundle: index });
    expect(res.status).toBe("resolved");
    if (res.status === "resolved") {
      const rt = res.target.properties.find((p) => p.name === "resourceType")?.value;
      expect(rt?.kind === "primitive" && rt.value).toBe("Patient");
    }
  });

  it("ignores entries with no resource / no fullUrl when indexing", () => {
    const { resource: b } = parseResource(
      '{"resourceType":"Bundle","type":"collection","entry":[' +
        '{"request":{"method":"GET","url":"Patient/1"}},' +
        '{"resource":{"resourceType":"Patient","id":"only-id"}}]}',
    );
    const idx = buildBundleIndex(b);
    expect(resolveReference("Patient/only-id", { bundle: idx }).status).toBe("resolved");
    expect(resolveReference("Patient/1", { bundle: idx }).status).toBe("unresolved");
  });
});

describe("hasContainedCycle: the DoS-safe cycle guard", () => {
  it("detects a two-node contained cycle (a → b → a)", () => {
    const { resource } = parseResource(
      '{"resourceType":"Observation","id":"root","contained":[' +
        '{"resourceType":"Observation","id":"a","hasMember":[{"reference":"#b"}]},' +
        '{"resourceType":"Observation","id":"b","hasMember":[{"reference":"#a"}]}]}',
    );
    expect(hasContainedCycle(resource)).toBe(true);
  });

  it("detects a self-cycle (a → a)", () => {
    const { resource } = parseResource(
      '{"resourceType":"Observation","id":"root","contained":[' +
        '{"resourceType":"Observation","id":"a","hasMember":[{"reference":"#a"}]}]}',
    );
    expect(hasContainedCycle(resource)).toBe(true);
  });

  it("detects a root ↔ contained cycle via a bare and named fragment", () => {
    const { resource } = parseResource(
      '{"resourceType":"Observation","id":"root","subject":{"reference":"#a"},"contained":[' +
        '{"resourceType":"Observation","id":"a","hasMember":[{"reference":"#"}]}]}',
    );
    expect(hasContainedCycle(resource)).toBe(true);
  });

  it("passes an acyclic contained graph (a DAG): the common, legitimate case", () => {
    const { resource } = parseResource(
      '{"resourceType":"MedicationRequest","id":"root",' +
        '"medicationReference":{"reference":"#med"},"contained":[' +
        '{"resourceType":"Medication","id":"med","ingredient":[{"itemReference":{"reference":"#sub"}}]},' +
        '{"resourceType":"Substance","id":"sub"}]}',
    );
    expect(hasContainedCycle(resource)).toBe(false);
  });

  it("a fragment to an absent contained is not a cycle (it is an unresolved edge)", () => {
    const { resource } = parseResource(
      '{"resourceType":"Observation","id":"root","contained":[' +
        '{"resourceType":"Observation","id":"a","hasMember":[{"reference":"#ghost"}]}]}',
    );
    expect(hasContainedCycle(resource)).toBe(false);
  });

  it("a resource with no contained never cycles", () => {
    const { resource } = parseResource('{"resourceType":"Patient","id":"x"}');
    expect(hasContainedCycle(resource)).toBe(false);
  });

  it("terminates on a long acyclic chain (bounded, no stack blow-up)", () => {
    // A chain c0 → c1 → … → cN, well within MAX_REFERENCE_DEPTH, must be walked without looping.
    const n = 100;
    const contained: string[] = [];
    for (let i = 0; i < n; i++) {
      const next = i < n - 1 ? `,"hasMember":[{"reference":"#c${String(i + 1)}"}]` : "";
      contained.push(`{"resourceType":"Observation","id":"c${String(i)}"${next}}`);
    }
    const { resource } = parseResource(
      `{"resourceType":"Observation","id":"root","contained":[${contained.join(",")}]}`,
    );
    expect(hasContainedCycle(resource)).toBe(false);
    expect(MAX_REFERENCE_DEPTH).toBeGreaterThan(0);
  });
});
