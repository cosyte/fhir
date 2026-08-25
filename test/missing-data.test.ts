/**
 * Declared absence: an element a sender explicitly does not know, told apart from one it never sent.
 *
 * A source system with no data for an element whose minimum cardinality is greater than zero cannot
 * omit it, so it writes the element present, with no value, carrying the R4 DataAbsentReason
 * extension and a reason code. Before this channel both shapes reached a caller as the same answer:
 * the element counts as present, so no required-element finding fires, and every value read returns
 * `undefined`, exactly as it does for an element nobody wrote. The declaration was in the document
 * and reachable nowhere else.
 *
 * **The three-way set is the load-bearing case.** Omitted, marked, and carrying an ordinary value
 * must be three distinguishable readings, and the difference must be reachable through the package's
 * own API without re-reading the wire bytes. Two of the three used to collapse.
 *
 * **The two neighbours that are NOT markers are pinned here too, in both directions.** The same
 * concepts used as a `Coding` inside a coded element are a present, conformant coded VALUE, and the
 * `Observation.dataAbsentReason` ELEMENT is an ordinary `CodeableConcept` with its own `obs-6`
 * invariant. Reading either as an absence would be a different question with a different failure
 * mode, so each is asserted to draw nothing here and to keep drawing exactly what it drew before.
 *
 * Every document below is synthetic and carries no name, date of birth, identifier or address.
 */

import { describe, expect, it } from "vitest";

import {
  absenceMarkers,
  assertSafeToSummarize,
  conflictingAbsenceMarkers,
  FhirSafetyError,
  getProperty,
  isAbsenceCode,
  isPrimitive,
  parseResource,
  parseResourceXml,
  readSafety,
  unreadableAbsenceMarkers,
  validateResource,
  ABSENCE_CODES,
  DATA_ABSENT_REASON_URL,
  type AbsenceCode,
  type SafetyReadout,
  type ValidationIssue,
} from "../src/index.js";
import { nth } from "./_util.js";

/** The extension canonical URL, spelled once so a fixture cannot drift from the constant. */
const DAR = DATA_ABSENT_REASON_URL;

/**
 * The DataAbsentReason CODE SYSTEM URI. It is NOT the extension's URL, and the distance between the
 * two is the whole of the recognition rule. One published implementation guide page writes this URI
 * as the extension's `url`, which is an error on that page; the extension definition fixes
 * `Extension.url` at {@link DATA_ABSENT_REASON_URL}, and that is the string this library matches.
 */
const DAR_CODE_SYSTEM = "http://terminology.hl7.org/CodeSystem/data-absent-reason";

/** A JSON DataAbsentReason extension carrying `reason`, for a primitive's `_`-sibling or an array. */
function marker(reason: string): string {
  return `{"url":"${DAR}","valueCode":${JSON.stringify(reason)}}`;
}

/**
 * An `Observation` whose mandatory `status` is spelled by `statusMembers`, with a mandatory `code`
 * present so that the only cardinality question in play is `status`'s own.
 */
function observation(statusMembers: string): string {
  return `{"resourceType":"Observation",${statusMembers}"code":{"text":"synthetic"}}`;
}

/** The three-way set: the same mandatory element omitted, marked absent, and carrying a value. */
const OMITTED = observation("");
const MARKED = observation(`"_status":{"extension":[${marker("unknown")}]},`);
const VALUED = observation('"status":"final",');

/** The readout of a JSON document. */
function safetyOf(json: string): SafetyReadout {
  return readSafety(parseResource(json).resource);
}

/** The readout of an XML document. */
function safetyOfXml(xml: string): SafetyReadout {
  return readSafety(parseResourceXml(xml).resource);
}

/**
 * The validation findings of a JSON document, as `CODE at location` strings.
 *
 * Joined with ` at ` rather than the `@` this package spells a diagnostic with, and the reason is a
 * gate rather than taste: an issue code joined to a FHIRPath by `@` is indistinguishable from an
 * email address by shape, so writing that form here would grow the PHI scan's declared-domain list
 * by one entry per FHIRPath root this file uses. The readout corpus joins its own strings the same
 * way for the same reason.
 */
function findingsOf(json: string): string[] {
  return validateResource(parseResource(json).resource).issues.map(
    (issue: ValidationIssue) => `${issue.code} at ${issue.expression}`,
  );
}

const FHIR_NS = 'xmlns="http://hl7.org/fhir"';

/** Whether the element at `name` is present in the model and holding no value of its own. */
function presentAndValueAbsent(json: string, name: string): boolean {
  const node = getProperty(parseResource(json).resource, name);
  return node !== undefined && isPrimitive(node) && node.value === undefined;
}

describe("a mandatory element carrying a DataAbsentReason extension is surfaced, not read as populated", () => {
  it("surfaces the absence reason for a mandatory element marked unknown", () => {
    const safety = safetyOf(MARKED);

    expect(safety.absenceMarkers).toEqual([{ code: "unknown", location: "Observation.status" }]);
  });

  it("does not treat the marked element as populated, on any read the package offers", () => {
    // Present in the model, and holding no value: the two halves of "present but not populated".
    expect(presentAndValueAbsent(MARKED, "status")).toBe(true);
    expect(safetyOf(MARKED).status).toBeUndefined();
  });

  it("recognises the marker on a complex element as well as on a primitive's metadata", () => {
    // The published Missing Data pattern for a non-coded element writes the extension on the
    // element itself, which for a complex element is its own `extension` property.
    const complexShape = safetyOf(
      `{"resourceType":"Observation","status":"final","code":{"extension":[${marker("masked")}]}}`,
    );

    expect(complexShape.absenceMarkers).toEqual([{ code: "masked", location: "Observation.code" }]);
  });

  it("recognises a marker written on an element of an unmodeled resource type", () => {
    // Nothing about the read is scoped to a resource type or to an element table: the extension's
    // URL is fixed by its own definition, so a type this package models nothing for is read too.
    const safety = safetyOf(
      `{"resourceType":"Procedure","_status":{"extension":[${marker("not-performed")}]}}`,
    );

    expect(safety.absenceMarkers).toEqual([
      { code: "not-performed", location: "Procedure.status" },
    ]);
  });
});

describe("a marker beside a value on one element is reported, never resolved", () => {
  const CONFLICT = observation(`"status":"final","_status":{"extension":[${marker("unknown")}]},`);

  it("emits a finding rather than silently preferring one of the two", () => {
    expect(findingsOf(CONFLICT)).toEqual(["ABSENCE_MARKER_CONFLICT at Observation.status"]);
    expect(validateResource(parseResource(CONFLICT).resource).valid).toBe(false);
  });

  it("keeps both the value and the declaration, so neither is preferred by omission", () => {
    const safety = safetyOf(CONFLICT);

    expect(safety.conflictingAbsenceMarkers).toEqual(["Observation.status"]);
    // The value is still read, and the declaration is still surfaced. Dropping either from the
    // readout would be exactly the silent preference the finding exists to prevent.
    expect(safety.status).toBe("final");
    expect(safety.absenceMarkers).toEqual([{ code: "unknown", location: "Observation.status" }]);
  });

  it("reports the same conflict on a complex element carrying content beside the marker", () => {
    const json = `{"resourceType":"Observation","status":"final","code":{"extension":[${marker(
      "unknown",
    )}],"text":"synthetic"}}`;

    expect(conflictingAbsenceMarkers(parseResource(json).resource, "Observation")).toEqual([
      "Observation.code",
    ]);
  });

  it("does not call an element's own id, url or extension members a value", () => {
    // R4 `Element` is `id` plus `extension`, and `Extension.url` is an extension's identity. An
    // element carrying only those beside a marker carries no value, so calling one a conflict would
    // be a false error on the very shape the pattern prescribes.
    const json = `{"resourceType":"Observation","status":"final","code":{"id":"c1","extension":[${marker(
      "unknown",
    )}]}}`;
    const safety = safetyOf(json);

    expect(safety.conflictingAbsenceMarkers).toEqual([]);
    expect(safety.absenceMarkers).toEqual([{ code: "unknown", location: "Observation.code" }]);
  });

  it("does not count the JSON encoding's resourceType as a value, so the formats agree", () => {
    // `resourceType` is how FHIR JSON names the type; FHIR XML spells it as the tag and has no such
    // element. Counting it as content would make one wire format report a conflict the other cannot.
    const json = `{"resourceType":"Observation","extension":[${marker("unknown")}]}`;

    expect(safetyOf(json).conflictingAbsenceMarkers).toEqual([]);
  });
});

describe("the three-way set: omitted, marked, and carrying a value are three readings", () => {
  /** Everything a caller can learn about the mandatory element from the package's API alone. */
  function reading(json: string): Record<string, unknown> {
    const { resource } = parseResource(json);
    const safety = readSafety(resource);
    const result = validateResource(resource);
    return {
      present: getProperty(resource, "status") !== undefined,
      value: safety.status,
      markers: safety.absenceMarkers,
      requiredFindings: result.issues
        .filter((issue: ValidationIssue) => issue.code === "CARDINALITY_MIN")
        .map((issue: ValidationIssue) => issue.expression),
    };
  }

  it("yields three distinguishable readings from the public API, with no wire text re-read", () => {
    const omitted = reading(OMITTED);
    const marked = reading(MARKED);
    const valued = reading(VALUED);

    expect(omitted).not.toEqual(marked);
    expect(marked).not.toEqual(valued);
    expect(omitted).not.toEqual(valued);
  });

  it("says why each of the three reads the way it does", () => {
    expect(reading(OMITTED)).toEqual({
      present: false,
      value: undefined,
      markers: [],
      requiredFindings: ["Observation.status"],
    });
    expect(reading(MARKED)).toEqual({
      present: true,
      value: undefined,
      markers: [{ code: "unknown", location: "Observation.status" }],
      requiredFindings: [],
    });
    expect(reading(VALUED)).toEqual({
      present: true,
      value: "final",
      markers: [],
      requiredFindings: [],
    });
  });

  it("separates the marked one from the omitted one on the channel a caller branches on", () => {
    // The pair that used to collapse: both leave the element value-absent, and only this channel
    // tells them apart without going back to the document.
    expect(safetyOf(MARKED).absenceMarkers).not.toEqual(safetyOf(OMITTED).absenceMarkers);
  });
});

describe("the reason the sender spelled is carried, not merely the fact of an absence", () => {
  const DISTINGUISHED: readonly AbsenceCode[] = [
    "unknown",
    "masked",
    "not-applicable",
    "not-performed",
  ];

  for (const code of DISTINGUISHED) {
    it(`carries ${code} on an instance otherwise identical to the others`, () => {
      const safety = safetyOf(observation(`"_status":{"extension":[${marker(code)}]},`));

      expect(safety.absenceMarkers).toEqual([{ code, location: "Observation.status" }]);
    });
  }

  it("gives the four instances four different readings", () => {
    const codes = DISTINGUISHED.map(
      (code) =>
        nth(safetyOf(observation(`"_status":{"extension":[${marker(code)}]},`)).absenceMarkers, 0)
          .code,
    );

    expect(new Set(codes).size).toBe(DISTINGUISHED.length);
  });

  it("reads every member of the published value set, and exactly those fifteen", () => {
    expect(ABSENCE_CODES).toHaveLength(15);
    for (const code of ABSENCE_CODES) {
      expect(
        safetyOf(observation(`"_status":{"extension":[${marker(code)}]},`)).absenceMarkers,
      ).toEqual([{ code, location: "Observation.status" }]);
    }
  });
});

describe("a report carries the reason and the location, and nothing else from the document", () => {
  it("carries no neighbouring content, no sibling member and no other member of the extension", () => {
    const sentinel = "Zq7SENTINEL";
    const json =
      `{"resourceType":"Observation","code":{"text":${JSON.stringify(sentinel)}},` +
      `"_status":{"extension":[{"url":"${DAR}","valueCode":"unknown","id":${JSON.stringify(
        sentinel,
      )}}]}}`;
    const safety = safetyOf(json);
    const surface = JSON.stringify([
      safety.absenceMarkers,
      safety.unreadableAbsenceMarkers,
      safety.conflictingAbsenceMarkers,
    ]);

    expect(safety.absenceMarkers).toEqual([{ code: "unknown", location: "Observation.status" }]);
    expect(surface).not.toContain(sentinel);
  });

  it("carries the code that failed the value set nowhere, on the unreadable channel", () => {
    const sentinel = "Zq7SENTINEL";
    const safety = safetyOf(observation(`"_status":{"extension":[${marker(sentinel)}]},`));

    expect(safety.unreadableAbsenceMarkers).toEqual(["Observation.status"]);
    expect(JSON.stringify(safety.unreadableAbsenceMarkers)).not.toContain(sentinel);
  });

  it("bounds a document-supplied element name in a marker's location, as every location is bounded", () => {
    // A property name is the one route by which document bytes of unbounded length could reach a
    // location, so this channel goes through the same bound every other location here goes through.
    const forged = "Not An Element Name!";
    const json = `{"resourceType":"Observation","status":"final",${JSON.stringify(
      forged,
    )}:{"extension":[${marker("masked")}]}}`;
    const safety = safetyOf(json);

    expect(safety.absenceMarkers).toEqual([{ code: "masked", location: "Observation.<withheld>" }]);
    expect(JSON.stringify(safety.absenceMarkers)).not.toContain(forged);
  });

  it("only ever carries one of the fifteen literal codes this package spells", () => {
    for (const { code } of safetyOf(MARKED).absenceMarkers) expect(isAbsenceCode(code)).toBe(true);
  });
});

describe("an unreadable reason is reported, never coerced and never read as populated", () => {
  const UNREADABLE: readonly [string, string][] = [
    ["no valueCode at all", `{"url":"${DAR}"}`],
    ["an empty valueCode", `{"url":"${DAR}","valueCode":""}`],
    ["a code outside the value set", `{"url":"${DAR}","valueCode":"no-such-reason"}`],
    ["a valueCode that is not a string", `{"url":"${DAR}","valueCode":{"value":"unknown"}}`],
    ["a valueCode written twice", `{"url":"${DAR}","valueCode":"unknown","valueCode":"masked"}`],
    ["a case variant of a member", `{"url":"${DAR}","valueCode":"UNKNOWN"}`],
    ["a member padded with whitespace", `{"url":"${DAR}","valueCode":" unknown"}`],
  ];

  for (const [label, extension] of UNREADABLE) {
    describe(label, () => {
      const json = observation(`"_status":{"extension":[${extension}]},`);

      it("names the element's location on the unreadable channel", () => {
        expect(safetyOf(json).unreadableAbsenceMarkers).toEqual(["Observation.status"]);
      });

      it("infers neither unknown nor any other reason from it", () => {
        expect(safetyOf(json).absenceMarkers).toEqual([]);
      });

      it("does not read the element as populated", () => {
        expect(presentAndValueAbsent(json, "status")).toBe(true);
        expect(safetyOf(json).status).toBeUndefined();
      });

      it("raises the unreadable finding, and never the conflict one", () => {
        expect(findingsOf(json)).toContain("ABSENCE_MARKER_UNREADABLE at Observation.status");
        expect(findingsOf(json)).not.toContain("ABSENCE_MARKER_CONFLICT at Observation.status");
      });
    });
  }

  it("reports the readable and the unreadable marker separately when an element carries both", () => {
    const json = observation(
      `"_status":{"extension":[${marker("masked")},{"url":"${DAR}","valueCode":"no-such-reason"}]},`,
    );
    const safety = safetyOf(json);

    expect(safety.absenceMarkers).toEqual([{ code: "masked", location: "Observation.status" }]);
    expect(safety.unreadableAbsenceMarkers).toEqual(["Observation.status"]);
  });
});

describe("a document carrying no marker reads exactly as it did before", () => {
  const CONFORMANT: readonly [string, string][] = [
    ["a plain Observation", VALUED],
    ["a mandatory element simply omitted", OMITTED],
    [
      "an extension that is not this one",
      observation('"status":"final","extension":[{"url":"http://example.org/x","valueCode":"a"}],'),
    ],
    [
      "the same concepts as a Coding inside a coded element",
      `{"resourceType":"Observation","status":"final","code":{"coding":[{"system":"${DAR_CODE_SYSTEM}","code":"unknown"}]}}`,
    ],
    [
      "an extension whose url is the code system URI rather than the extension's own",
      `{"resourceType":"Observation","status":"final","code":{"extension":[{"url":"${DAR_CODE_SYSTEM}","valueCode":"unknown"}]}}`,
    ],
  ];

  for (const [label, json] of CONFORMANT) {
    it(`draws nothing on every absence channel for ${label}`, () => {
      const safety = safetyOf(json);

      expect(safety.absenceMarkers).toEqual([]);
      expect(safety.unreadableAbsenceMarkers).toEqual([]);
      expect(safety.conflictingAbsenceMarkers).toEqual([]);
    });

    it(`adds no finding for ${label}`, () => {
      expect(findingsOf(json).filter((finding) => finding.startsWith("ABSENCE_MARKER_"))).toEqual(
        [],
      );
    });
  }

  it("reads a coded element's DataAbsentReason Coding as the present coded value it is", () => {
    // Explicitly out of scope, and asserted rather than assumed: the code system used inside a
    // `CodeableConcept` is a conformant coded VALUE, not an absent element.
    const json = `{"resourceType":"Observation","status":"final","code":{"coding":[{"system":"${DAR_CODE_SYSTEM}","code":"unknown"}]}}`;
    const { resource } = parseResource(json);

    expect(readSafety(resource).absenceMarkers).toEqual([]);
    expect(getProperty(resource, "code")).toBeDefined();
  });
});

describe("required-element reporting moves in neither direction", () => {
  it("does not report a mandatory element present with only a marker as absent", () => {
    // The pattern requires exactly this encoding, so a required-element finding here would be a
    // false error on a conformant instance.
    expect(findingsOf(MARKED)).not.toContain("CARDINALITY_MIN at Observation.status");
    expect(validateResource(parseResource(MARKED).resource).valid).toBe(true);
  });

  it("keeps reporting a mandatory element that is omitted entirely", () => {
    expect(findingsOf(OMITTED)).toContain("CARDINALITY_MIN at Observation.status");
  });

  it("reports the omitted one and not the marked one, on the same document shape", () => {
    const required = (json: string): string[] =>
      findingsOf(json).filter((finding) => finding.startsWith("CARDINALITY_MIN at "));

    expect(required(OMITTED)).toEqual(["CARDINALITY_MIN at Observation.status"]);
    expect(required(MARKED)).toEqual([]);
    expect(required(VALUED)).toEqual([]);
  });
});

describe("summarizability: a readable declaration stands, a contradiction or a refusal does not", () => {
  it("keeps affirming over one or more readable, non-conflicting markers", () => {
    const json = observation(
      `"_status":{"extension":[${marker("unknown")}]},"subject":{"extension":[${marker(
        "masked",
      )}]},`,
    );
    const safety = safetyOf(json);

    expect(safety.absenceMarkers).toHaveLength(2);
    expect(safety.safeToSummarize).toBe(true);
    expect(() => {
      assertSafeToSummarize(parseResource(json).resource);
    }).not.toThrow();
  });

  it("stops affirming over a conflicting marker, and carries its location", () => {
    const json = observation(`"status":"final","_status":{"extension":[${marker("unknown")}]},`);
    const { resource } = parseResource(json);

    expect(readSafety(resource).safeToSummarize).toBe(false);
    try {
      assertSafeToSummarize(resource);
      expect.unreachable("assertSafeToSummarize must refuse a declared absence beside a value");
    } catch (err) {
      expect(err).toBeInstanceOf(FhirSafetyError);
      expect((err as FhirSafetyError).locations).toEqual(["Observation.status"]);
    }
  });

  it("stops affirming over an unreadable marker, and carries its location", () => {
    const json = observation(`"_status":{"extension":[${marker("no-such-reason")}]},`);
    const { resource } = parseResource(json);

    expect(readSafety(resource).safeToSummarize).toBe(false);
    try {
      assertSafeToSummarize(resource);
      expect.unreachable("assertSafeToSummarize must refuse an unreadable declared absence");
    } catch (err) {
      expect(err).toBeInstanceOf(FhirSafetyError);
      expect((err as FhirSafetyError).locations).toEqual(["Observation.status"]);
    }
  });

  it("carries one location per element, however many markers sit on it", () => {
    const json = observation(
      `"_status":{"extension":[${marker("no-such-reason")},${marker("also-not-a-reason")}]},`,
    );

    expect(safetyOf(json).unreadableAbsenceMarkers).toEqual(["Observation.status"]);
  });
});

describe("the dataAbsentReason ELEMENT and its obs-6 invariant are a different question", () => {
  const ELEMENT_BESIDE_VALUE =
    '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"},' +
    `"dataAbsentReason":{"coding":[{"system":"${DAR_CODE_SYSTEM}","code":"unknown"}]},` +
    '"valueString":"synthetic"}';

  it("emits exactly the existing obs-6 finding for the element beside a value", () => {
    const issues = validateResource(parseResource(ELEMENT_BESIDE_VALUE).resource).issues;
    const invariants = issues.filter(
      (issue: ValidationIssue) => issue.code === "INVARIANT_VIOLATED",
    );

    expect(invariants).toHaveLength(1);
    expect(nth(invariants, 0).constraint).toBe("obs-6");
    expect(nth(invariants, 0).expression).toBe("Observation.dataAbsentReason");
  });

  it("emits no absence-marker finding for it, because the element is not the extension", () => {
    expect(
      findingsOf(ELEMENT_BESIDE_VALUE).filter((finding) => finding.startsWith("ABSENCE_MARKER_")),
    ).toEqual([]);
    expect(safetyOf(ELEMENT_BESIDE_VALUE).absenceMarkers).toEqual([]);
  });

  it("does not report an Observation carrying the extension as an obs-6 violation", () => {
    const json =
      '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"},' +
      `"_valueString":{"extension":[${marker("unknown")}]}}`;
    const issues = validateResource(parseResource(json).resource).issues;

    expect(issues.filter((issue: ValidationIssue) => issue.constraint === "obs-6")).toEqual([]);
    expect(safetyOf(json).absenceMarkers).toEqual([
      { code: "unknown", location: "Observation.valueString" },
    ]);
  });

  it("does not double-report when a resource carries the element and the extension both", () => {
    const json =
      '{"resourceType":"Observation","code":{"text":"synthetic"},' +
      `"dataAbsentReason":{"coding":[{"system":"${DAR_CODE_SYSTEM}","code":"unknown"}]},` +
      `"_status":{"extension":[${marker("unknown")}]}}`;
    const findings = findingsOf(json);

    // The element is present with no `value[x]`, which obs-6 permits; the extension is readable and
    // non-conflicting, which draws nothing. Neither rule fires, and neither displaces the other.
    expect(findings.filter((finding) => finding.startsWith("ABSENCE_MARKER_"))).toEqual([]);
    expect(findings.filter((finding) => finding.startsWith("INVARIANT_VIOLATED"))).toEqual([]);
    expect(safetyOf(json).absenceMarkers).toEqual([
      { code: "unknown", location: "Observation.status" },
    ]);
  });
});

describe("the two wire formats agree about what the sender declared", () => {
  /** One instance, spelled both ways: a marked mandatory primitive and a marked complex element. */
  const JSON_SPELLING =
    '{"resourceType":"Observation","code":{"text":"synthetic"},' +
    `"_status":{"extension":[${marker("unknown")}]},` +
    `"subject":{"extension":[${marker("masked")}]}}`;
  const XML_SPELLING =
    `<Observation ${FHIR_NS}><code><text value="synthetic"/></code>` +
    `<status><extension url="${DAR}"><valueCode value="unknown"/></extension></status>` +
    `<subject><extension url="${DAR}"><valueCode value="masked"/></extension></subject>` +
    "</Observation>";

  it("surfaces the same markers, with the same reasons and the same locations", () => {
    expect(safetyOfXml(XML_SPELLING).absenceMarkers).toEqual(
      safetyOf(JSON_SPELLING).absenceMarkers,
    );
    expect(safetyOf(JSON_SPELLING).absenceMarkers).toEqual([
      { code: "unknown", location: "Observation.status" },
      { code: "masked", location: "Observation.subject" },
    ]);
  });

  it("agrees about a conflict, on the element that carries a value beside its marker", () => {
    const json =
      '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"},' +
      `"_status":{"extension":[${marker("unknown")}]}}`;
    const xml =
      `<Observation ${FHIR_NS}><code><text value="synthetic"/></code>` +
      `<status value="final"><extension url="${DAR}"><valueCode value="unknown"/></extension>` +
      "</status></Observation>";

    expect(safetyOfXml(xml).conflictingAbsenceMarkers).toEqual(
      safetyOf(json).conflictingAbsenceMarkers,
    );
    expect(safetyOfXml(xml).conflictingAbsenceMarkers).toEqual(["Observation.status"]);
  });

  it("agrees about an unreadable reason", () => {
    const json = observation(`"_status":{"extension":[${marker("no-such-reason")}]},`);
    const xml =
      `<Observation ${FHIR_NS}><code><text value="synthetic"/></code>` +
      `<status><extension url="${DAR}"><valueCode value="no-such-reason"/></extension>` +
      "</status></Observation>";

    expect(safetyOfXml(xml).unreadableAbsenceMarkers).toEqual(
      safetyOf(json).unreadableAbsenceMarkers,
    );
    expect(safetyOfXml(xml).unreadableAbsenceMarkers).toEqual(["Observation.status"]);
  });
});

describe("a marker on a nested resource is surfaced with a location that names where it sits", () => {
  it("names a contained resource's element, not only the resource handed in", () => {
    const json =
      '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"},' +
      `"contained":[{"resourceType":"Patient","_gender":{"extension":[${marker("asked-declined")}]}}]}`;

    expect(safetyOf(json).absenceMarkers).toEqual([
      { code: "asked-declined", location: "Observation.contained[0].gender" },
    ]);
  });

  it("names a Bundle entry's element", () => {
    const json =
      '{"resourceType":"Bundle","type":"collection","entry":[{"resource":' +
      `{"resourceType":"Observation","code":{"text":"synthetic"},"_status":{"extension":[${marker(
        "temp-unknown",
      )}]}}}]}`;

    expect(safetyOf(json).absenceMarkers).toEqual([
      { code: "temp-unknown", location: "Bundle.entry[0].resource.status" },
    ]);
  });

  it("names each entry of a repeating element separately", () => {
    const json =
      '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"},' +
      `"performer":[{"extension":[${marker("unknown")}]},{"reference":"Practitioner/1"},{"extension":[${marker(
        "masked",
      )}]}]}`;

    expect(safetyOf(json).absenceMarkers).toEqual([
      { code: "unknown", location: "Observation.performer[0]" },
      { code: "masked", location: "Observation.performer[2]" },
    ]);
  });

  it("reaches a marker nested inside another extension", () => {
    const json =
      '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"},' +
      `"extension":[{"url":"http://example.org/wrapper","extension":[${marker("unsupported")}]}]}`;

    expect(safetyOf(json).absenceMarkers).toEqual([
      { code: "unsupported", location: "Observation.extension[0]" },
    ]);
  });
});

describe("the surface is reachable from the package entry point", () => {
  it("exports the readers, the constants and the membership test", () => {
    expect(typeof absenceMarkers).toBe("function");
    expect(typeof unreadableAbsenceMarkers).toBe("function");
    expect(typeof conflictingAbsenceMarkers).toBe("function");
    expect(typeof isAbsenceCode).toBe("function");
    expect(DATA_ABSENT_REASON_URL).toBe(
      "http://hl7.org/fhir/StructureDefinition/data-absent-reason",
    );
  });

  it("gives the standalone readers and the readout channels one answer, not two", () => {
    const { resource } = parseResource(MARKED);

    expect(absenceMarkers(resource, "Observation")).toEqual(readSafety(resource).absenceMarkers);
    expect(unreadableAbsenceMarkers(resource, "Observation")).toEqual(
      readSafety(resource).unreadableAbsenceMarkers,
    );
    expect(conflictingAbsenceMarkers(resource, "Observation")).toEqual(
      readSafety(resource).conflictingAbsenceMarkers,
    );
  });
});
