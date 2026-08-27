import { describe, expect, it } from "vitest";

import {
  buildBindingRegistry,
  collectTerminologyIssues,
  diagnosticFor,
  isKnownSystem,
  parseResource,
  serializeResource,
  toOperationOutcome,
  validateResource,
  ALLERGY_SUBSTANCE_VALUESET,
  BINDING_STRENGTHS,
  CODE_SYSTEM_VERSION_RECORD_CODES,
  CODE_SYSTEM_VERSION_RECORD_SYSTEM,
  CPT_SYSTEM,
  CVX_SYSTEM,
  ICD9CM_SYSTEM,
  ICD10CM_SYSTEM,
  KNOWN_SYSTEMS,
  LOINC_SYSTEM,
  MEDICATION_VALUESET,
  NDC_SYSTEM,
  RXNORM_SYSTEM,
  SNOMED_SCT,
  TERMINOLOGY_BINDINGS,
  UCUM_SYSTEM,
  type CodeMembership,
  type CodeValidationRequest,
  type CodeValidationResult,
  type FhirComplex,
  type TerminologyService,
  type ValidationIssue,
} from "../src/index.js";

/**
 * The known-systems registry is a **frozen set of identities** (roadmap §5), verified URIs only, no
 * content. These pin which systems are recognized and confirm the open-question ones (ICD-10-PCS,
 * HCPCS, roadmap §10) are deliberately absent rather than guessed.
 */
describe("known-systems registry (identities only, verified URIs)", () => {
  it("recognizes every roadmap §5 verified system URI", () => {
    for (const uri of [
      LOINC_SYSTEM,
      SNOMED_SCT,
      RXNORM_SYSTEM,
      ICD10CM_SYSTEM,
      ICD9CM_SYSTEM,
      CPT_SYSTEM,
      UCUM_SYSTEM,
      NDC_SYSTEM,
      CVX_SYSTEM,
    ]) {
      expect(isKnownSystem(uri)).toBe(true);
      expect(KNOWN_SYSTEMS.has(uri)).toBe(true);
    }
  });

  it("pins the exact system URIs (a change is a public-contract change)", () => {
    expect(RXNORM_SYSTEM).toBe("http://www.nlm.nih.gov/research/umls/rxnorm");
    expect(ICD10CM_SYSTEM).toBe("http://hl7.org/fhir/sid/icd-10-cm");
    expect(CVX_SYSTEM).toBe("http://hl7.org/fhir/sid/cvx");
    expect(NDC_SYSTEM).toBe("http://hl7.org/fhir/sid/ndc");
  });

  it("does NOT guess the open-question URIs (ICD-10-PCS, HCPCS: roadmap §10)", () => {
    // Absence reads as 'unknown', a safe non-erroring degrade, never a false identity.
    expect(isKnownSystem("http://hl7.org/fhir/sid/icd-10-pcs")).toBe(false);
    expect(isKnownSystem("urn:oid:2.16.840.1.113883.6.285")).toBe(false); // HCPCS OID
  });

  it("treats an unrecognized (local/proprietary) system as unknown, not invalid", () => {
    expect(isKnownSystem("http://example.org/local-codes")).toBe(false);
  });
});

/** The binding registry, the roadmap-named multi-system elements, plus caller overrides. */
describe("terminology bindings (identities + strength, extensible built-ins)", () => {
  it("binds AllergyIntolerance.code extensibly to the multi-system substance value set", () => {
    const binding = buildBindingRegistry()("AllergyIntolerance.code");
    expect(binding?.strength).toBe("extensible");
    expect(binding?.valueSet).toBe(ALLERGY_SUBSTANCE_VALUESET);
    // The roadmap §4.3 multi-system requirement: RxNorm (drug) + SNOMED (food/env + negations).
    expect(binding?.systems).toEqual([RXNORM_SYSTEM, SNOMED_SCT]);
  });

  it("binds both medication resource variants extensibly to the RxNorm value set", () => {
    const registry = buildBindingRegistry();
    for (const path of [
      "MedicationRequest.medicationCodeableConcept",
      "MedicationStatement.medicationCodeableConcept",
    ]) {
      const binding = registry(path);
      expect(binding?.strength).toBe("extensible");
      expect(binding?.valueSet).toBe(MEDICATION_VALUESET);
      expect(binding?.systems).toEqual([RXNORM_SYSTEM]);
    }
  });

  it("returns undefined for an element with no registered binding", () => {
    expect(buildBindingRegistry()("Patient.gender")).toBeUndefined();
  });

  it("lets a caller add and override bindings by path", () => {
    const registry = buildBindingRegistry([
      { path: "Observation.method", valueSet: "http://x/vs", strength: "example" },
      {
        path: "AllergyIntolerance.code",
        valueSet: "http://x/override",
        strength: "required",
        systems: [SNOMED_SCT],
      },
    ]);
    expect(registry("Observation.method")?.strength).toBe("example");
    expect(registry("AllergyIntolerance.code")?.strength).toBe("required");
    expect(registry("AllergyIntolerance.code")?.valueSet).toBe("http://x/override");
  });

  it("pins the strength ladder and the built-in binding count", () => {
    expect(BINDING_STRENGTHS).toEqual(["required", "extensible", "preferred", "example"]);
    expect(TERMINOLOGY_BINDINGS).toHaveLength(3);
  });
});

/**
 * The terminology-service interface is the one content seam; the library bundles none. A conformant
 * implementation is value-free (identities only) and can always answer "unknown".
 */
describe("terminology-service interface (pluggable, none bundled)", () => {
  it("is satisfiable by a small fail-safe stub that receives only identities", () => {
    const seen: CodeValidationRequest[] = [];
    const service: TerminologyService = {
      validateCode(request) {
        seen.push(request);
        if (request.valueSet !== MEDICATION_VALUESET) return { membership: "unknown" };
        return { membership: request.code === "1049502" ? "in" : "not-in" };
      },
    };
    expect(
      service.validateCode({
        valueSet: MEDICATION_VALUESET,
        system: RXNORM_SYSTEM,
        code: "1049502",
      }),
    ).toEqual({ membership: "in" });
    expect(
      service.validateCode({ valueSet: "http://other", system: RXNORM_SYSTEM, code: "x" }),
    ).toEqual({ membership: "unknown" });
    // The request carries only identities, never a resource or a patient value.
    expect(Object.keys(seen[0] ?? {}).sort()).toEqual(["code", "system", "valueSet"]);
  });
});

/**
 * A membership answer may declare the code-system release it was made against, so a `not-in` is
 * readable months later as an answer against one release rather than as a timeless fact. The
 * declaration is the caller's own assertion: the library verifies nothing about it, preserves it
 * exactly, marks its absence rather than implying currency, and never reads a release out of the
 * document being validated.
 */
describe("declared code-system release (per answer, caller-asserted, never from the instance)", () => {
  /** A code no service in this block reports as a member. */
  const NOT_A_MEMBER = "999999";
  /** Deliberately padded and multi-word: an exact-preservation probe, not a tidy version string. */
  const PADDED_RELEASE = "  2026-08-04 RxNorm full  ";
  /** A release string written on the DOCUMENT, which may never reach a finding. */
  const INSTANCE_RELEASE = "instance-release-2026-01-01";
  /** The one finding location the fixture below produces. */
  const CODING_PATH = "MedicationRequest.medicationCodeableConcept.coding[0]";

  /** A MedicationRequest whose medication coding is RxNorm, the system its binding expects. */
  function rxNormRequest(codingExtras = ""): FhirComplex {
    const { resource } = parseResource(
      `{"resourceType":"MedicationRequest","medicationCodeableConcept":{"coding":[` +
        `{"system":"${RXNORM_SYSTEM}","code":"${NOT_A_MEMBER}"${codingExtras}}]}}`,
    );
    return resource;
  }

  /** A service that answers `not-in` for every question and declares no release. */
  const silent: TerminologyService = { validateCode: () => ({ membership: "not-in" }) };

  /** A service that answers `not-in` and declares `release`. */
  function declaring(release: string): TerminologyService {
    return { validateCode: () => ({ membership: "not-in", systemVersion: release }) };
  }

  /**
   * A service handing back a `systemVersion` the interface's own types forbid. Only untyped
   * JavaScript can produce this, and surviving it is the whole point of the degrade, so the cast is
   * the subject of the test rather than a convenience around one.
   */
  function malformed(release: unknown): TerminologyService {
    return {
      validateCode: () =>
        ({ membership: "not-in", systemVersion: release }) as unknown as CodeValidationResult,
    };
  }

  /** The single membership finding the terminology layer emits for the fixture. */
  function membershipIssue(service: TerminologyService, codingExtras = ""): ValidationIssue {
    const issues = collectTerminologyIssues(rxNormRequest(codingExtras), "MedicationRequest", {
      terminology: service,
    });
    expect(issues).toHaveLength(1);
    const [issue] = issues;
    if (issue === undefined) throw new Error("expected exactly one membership finding");
    expect(issue.code).toBe("CODE_NOT_IN_VALUESET");
    return issue;
  }

  it("carries a declared release onto the finding, preserved exactly", () => {
    expect(membershipIssue(declaring(PADDED_RELEASE)).codeSystemVersion).toEqual({
      declared: true,
      version: PADDED_RELEASE,
    });
    // No normalisation, truncation or substitution: whitespace, case and length survive, and a
    // service that declares the literal marker word still declares a release, because the marker
    // lives in a different element from the string and the two can never be confused.
    for (const release of [
      "2.78",
      "20260301",
      "http://snomed.info/sct/731000124108/version/20260301",
      "UNDECLARED",
      CODE_SYSTEM_VERSION_RECORD_CODES.UNDECLARED,
      "0",
      "a".repeat(512),
    ]) {
      expect(membershipIssue(declaring(release)).codeSystemVersion).toEqual({
        declared: true,
        version: release,
      });
    }
  });

  it("records the release on the finding a caller reads back out of the validation result", () => {
    const { issues } = validateResource(rxNormRequest(), { terminology: declaring("2.78") });
    const membership = issues.filter((i) => i.code === "CODE_NOT_IN_VALUESET");
    expect(membership).toHaveLength(1);
    expect(membership[0]?.codeSystemVersion).toEqual({ declared: true, version: "2.78" });
  });

  it("surfaces a declared release on the outcome issue, leaving diagnostics code-derived", () => {
    const outcome = serializeResource(toOperationOutcome([membershipIssue(declaring("2.78"))]));
    expect(JSON.parse(outcome)).toEqual({
      resourceType: "OperationOutcome",
      issue: [
        {
          severity: "error",
          code: "code-invalid",
          diagnostics: diagnosticFor("CODE_NOT_IN_VALUESET"),
          details: {
            coding: [
              {
                system: CODE_SYSTEM_VERSION_RECORD_SYSTEM,
                code: CODE_SYSTEM_VERSION_RECORD_CODES.DECLARED,
              },
            ],
            text: "2.78",
          },
          expression: [CODING_PATH],
        },
      ],
    });
    // The redaction chokepoint holds: the release rides BESIDE the text, never inside it, and the
    // diagnostic is the code's own line, character for character.
    expect(diagnosticFor("CODE_NOT_IN_VALUESET")).not.toContain("2.78");
  });

  it("marks an undeclared release explicitly, on the finding and on the outcome", () => {
    const issue = membershipIssue(silent);
    // Absence is a POSITIVE record, distinguishable from a known release and from no record at all.
    expect(issue.codeSystemVersion).toEqual({ declared: false });
    expect(issue.codeSystemVersion).not.toEqual(
      membershipIssue(declaring("2.78")).codeSystemVersion,
    );
    // Otherwise the finding is exactly the one emitted before a release could be declared.
    expect(issue.code).toBe("CODE_NOT_IN_VALUESET");
    expect(issue.severity).toBe("error");
    expect(issue.type).toBe("code-invalid");
    expect(issue.expression).toBe(CODING_PATH);

    const outcome = serializeResource(toOperationOutcome([issue]));
    expect(JSON.parse(outcome)).toMatchObject({
      issue: [
        {
          diagnostics: diagnosticFor("CODE_NOT_IN_VALUESET"),
          details: {
            coding: [
              {
                system: CODE_SYSTEM_VERSION_RECORD_SYSTEM,
                code: CODE_SYSTEM_VERSION_RECORD_CODES.UNDECLARED,
              },
            ],
          },
        },
      ],
    });
    // No empty release is emitted: the undeclared case writes the marker and no text at all.
    expect(outcome).not.toContain('"text"');
  });

  it("degrades a malformed declaration to undeclared, without throwing", () => {
    for (const bad of [undefined, "", "   ", "\t\n ", 2026, null, {}, ["2.78"], true, NaN]) {
      const issue = membershipIssue(malformed(bad));
      expect(issue.codeSystemVersion).toEqual({ declared: false });
    }
    // Not an empty release, and never a default / latest / current one substituted for the silence.
    const outcome = serializeResource(toOperationOutcome([membershipIssue(malformed(" "))]));
    expect(outcome).toContain(CODE_SYSTEM_VERSION_RECORD_CODES.UNDECLARED);
    expect(outcome).not.toContain('"text"');
    expect(outcome).not.toMatch(/current|latest|default/i);
  });

  it("never reads the resource's own Coding.version", () => {
    const codingExtras = `,"version":"${INSTANCE_RELEASE}"`;
    const seen: CodeValidationRequest[] = [];
    const watcher: TerminologyService = {
      validateCode(request) {
        seen.push(request);
        return { membership: "not-in" };
      },
    };

    const issues = collectTerminologyIssues(rxNormRequest(codingExtras), "MedicationRequest", {
      terminology: watcher,
    });
    expect(JSON.stringify(issues)).not.toContain(INSTANCE_RELEASE);
    expect(issues[0]?.codeSystemVersion).toEqual({ declared: false });
    expect(serializeResource(toOperationOutcome(issues))).not.toContain(INSTANCE_RELEASE);
    // The element does not reach the service either: it is asked about identities and nothing else.
    expect(Object.keys(seen[0] ?? {}).sort()).toEqual(["code", "system", "valueSet"]);

    // A declared release wins over the document's, and the document's still appears nowhere.
    const declared = membershipIssue(declaring("2.78"), codingExtras);
    expect(declared.codeSystemVersion).toEqual({ declared: true, version: "2.78" });
    expect(serializeResource(toOperationOutcome([declared]))).not.toContain(INSTANCE_RELEASE);

    // Nor through the whole validator, in any finding, any outcome, or any diagnostics string.
    const result = validateResource(rxNormRequest(codingExtras), {
      terminology: declaring("2.78"),
    });
    expect(JSON.stringify(result.issues)).not.toContain(INSTANCE_RELEASE);
    expect(serializeResource(result.toOperationOutcome())).not.toContain(INSTANCE_RELEASE);
  });

  it("records nothing for in, unknown, or no service at all, whatever was declared", () => {
    const answering = (membership: CodeMembership): TerminologyService => ({
      validateCode: () => ({ membership, systemVersion: "2.78" }),
    });
    for (const membership of ["in", "unknown"] as const) {
      const issues = collectTerminologyIssues(rxNormRequest(), "MedicationRequest", {
        terminology: answering(membership),
      });
      expect(issues).toEqual([]);
    }
    // No service at all: the fail-safe degrade is unchanged and records no release either.
    expect(collectTerminologyIssues(rxNormRequest(), "MedicationRequest")).toEqual([]);
  });

  it("carries no release record on the content-free system checks", () => {
    const allergy = (system: string): FhirComplex => {
      const { resource } = parseResource(
        `{"resourceType":"AllergyIntolerance","code":{"coding":[` +
          `{"system":"${system}","code":"T78.40XA"}]}}`,
      );
      return resource;
    };
    const cases = [
      [ICD10CM_SYSTEM, "CODE_SYSTEM_UNEXPECTED"],
      ["http://example.org/local-codes", "CODE_SYSTEM_UNKNOWN"],
    ] as const;
    for (const [system, code] of cases) {
      const issues = collectTerminologyIssues(allergy(system), "AllergyIntolerance", {
        terminology: declaring("2.78"),
      });
      expect(issues).toHaveLength(1);
      expect(issues[0]?.code).toBe(code);
      // No service was consulted to produce these, so there is no release to record: absent, which
      // is a third state and not the undeclared marker.
      expect(issues[0]?.codeSystemVersion).toBeUndefined();
      const outcome = serializeResource(toOperationOutcome(issues));
      expect(outcome).not.toContain("details");
      expect(outcome).not.toContain("2.78");
    }
  });

  it("type-checks an existing service that declares nothing, with no edit to it", () => {
    // Exactly the shape the interface carried before a release could be declared: nothing added and
    // nothing renamed. `pnpm typecheck` compiles this file, so its compiling IS the assertion.
    const unchanged: TerminologyService = {
      validateCode({ valueSet, code }) {
        if (valueSet !== MEDICATION_VALUESET) return { membership: "unknown" };
        return { membership: code === "1049502" ? "in" : "not-in" };
      },
    };
    expect(membershipIssue(unchanged).codeSystemVersion).toEqual({ declared: false });
  });
});
