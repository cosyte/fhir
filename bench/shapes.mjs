// The FHIR inputs the benchmarks and the profile run on, built in code from an index.
//
// Each shape is one kind of traffic a FHIR server or client handles every day:
// - `observation(i)`: a vital-signs Observation of about 1.5 KiB, the resource a subscription or a
//   feed carries all day;
// - `transactionBundle(i, entries)`: a transaction Bundle of Patient, Encounter, Condition,
//   Observation and MedicationRequest entries linked by `urn:uuid` references, the shape a bulk load
//   or a chart import posts in one request;
// - `searchsetBundle(i, matches)`: a searchset page of Observations with their Patient included, the
//   shape a client reads back from `GET Observation?...&_include=Observation:subject`;
// - `containedPatient(i, contained)`: a Patient that is deep and wide at once: many names,
//   identifiers, addresses and telecoms, extensions nested several levels, and many contained
//   resources, the shape an export that inlines a chart produces;
// - `reportWithAttachment(i, bytes)`: a DiagnosticReport whose `presentedForm` carries a base64 PDF,
//   the large opaque payload: one string that is most of the document.
//
// Every name, identifier, code value and date is made up. The names are the placeholder words this
// repository's PHI scan allows (Synthfamily, Synthgiven); no file is read.

const KIB = 1024;

/** A zero-padded index, so every resource of a shape has the same length whatever its index. */
function pad(i, width = 6) {
  return String(i % 10 ** width).padStart(width, "0");
}

/** A synthetic `urn:uuid` for entry `k` of document `i`, the same length for every index. */
function uuid(i, k) {
  return `urn:uuid:00000000-0000-4000-8000-${pad(i, 4)}${pad(k, 8)}`;
}

/** A coding as most servers send it: system, code and display. */
function coding(system, code, display) {
  return { system, code, display };
}

const LOINC = "http://loinc.org";
const SNOMED = "http://snomed.info/sct";
const UCUM = "http://unitsofmeasure.org";
const RXNORM = "http://www.nlm.nih.gov/research/umls/rxnorm";
const OBS_CATEGORY = "http://terminology.hl7.org/CodeSystem/observation-category";

/** A blood pressure Observation with two components. `subject` is the reference it points at. */
function bloodPressure(i, id, subject) {
  return {
    resourceType: "Observation",
    id,
    meta: {
      versionId: "1",
      lastUpdated: "2026-01-01T09:00:00.000Z",
      profile: ["http://hl7.org/fhir/StructureDefinition/vitalsigns"],
    },
    identifier: [{ system: "urn:oid:2.16.840.1.113883.19.5", value: `OBS-${pad(i)}` }],
    status: "final",
    category: [{ coding: [coding(OBS_CATEGORY, "vital-signs", "Vital Signs")] }],
    code: {
      coding: [coding(LOINC, "85354-9", "Blood pressure panel with all children optional")],
      text: "Blood pressure",
    },
    subject: { reference: subject },
    encounter: { reference: `Encounter/ENC-${pad(i)}` },
    effectiveDateTime: "2026-01-01T09:00:00Z",
    issued: "2026-01-01T09:05:00.000Z",
    performer: [{ reference: `Practitioner/PRAC-${pad(i % 97)}` }],
    interpretation: [
      {
        coding: [
          coding(
            "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
            "N",
            "Normal",
          ),
        ],
      },
    ],
    component: [
      {
        code: { coding: [coding(LOINC, "8480-6", "Systolic blood pressure")] },
        valueQuantity: {
          value: 100 + (i % 40),
          unit: "mmHg",
          system: UCUM,
          code: "mm[Hg]",
        },
      },
      {
        code: { coding: [coding(LOINC, "8462-4", "Diastolic blood pressure")] },
        valueQuantity: {
          value: 60 + (i % 30),
          unit: "mmHg",
          system: UCUM,
          code: "mm[Hg]",
        },
      },
    ],
  };
}

/** A body weight Observation with a decimal value, as a lab or a device sends it. */
function bodyWeight(i, id, subject) {
  return {
    resourceType: "Observation",
    id,
    status: "final",
    category: [{ coding: [coding(OBS_CATEGORY, "vital-signs", "Vital Signs")] }],
    code: { coding: [coding(LOINC, "29463-7", "Body weight")], text: "Weight" },
    subject: { reference: subject },
    effectiveDateTime: "2026-01-01T09:00:00Z",
    valueQuantity: { value: 70.25 + (i % 20), unit: "kg", system: UCUM, code: "kg" },
  };
}

/** A synthetic Patient. `wide` adds the names, identifiers, telecoms and addresses a chart carries. */
function patient(i, id, wide = 1) {
  const names = [];
  const identifiers = [];
  const telecoms = [];
  const addresses = [];
  for (let k = 0; k < wide; k++) {
    names.push({
      use: k === 0 ? "official" : "old",
      family: "Synthfamily",
      given: ["Synthgiven", "Synthmiddle"],
      period: { start: "2020-01-01", end: k === 0 ? undefined : "2024-01-01" },
    });
    identifiers.push({
      use: "usual",
      type: { coding: [coding("http://terminology.hl7.org/CodeSystem/v2-0203", "MR")] },
      system: `urn:oid:2.16.840.1.113883.19.${String(k + 1)}`,
      value: `SYN-${pad(i)}-${pad(k, 3)}`,
    });
    telecoms.push({ system: "email", value: `synth${pad(k, 3)}@example.com`, use: "home" });
    addresses.push({
      use: k === 0 ? "home" : "old",
      line: ["534 Erewhon St"],
      city: "Anytown",
      state: "CA",
      postalCode: "90001",
      country: "US",
    });
  }
  return {
    resourceType: "Patient",
    id,
    meta: { versionId: "1", lastUpdated: "2026-01-01T09:00:00.000Z" },
    identifier: identifiers,
    active: true,
    name: names,
    telecom: telecoms,
    gender: i % 2 === 0 ? "female" : "male",
    birthDate: "1970-01-01",
    address: addresses,
  };
}

/** An Encounter for the patient at `subject`. */
function encounter(i, id, subject) {
  return {
    resourceType: "Encounter",
    id,
    status: "finished",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
      display: "ambulatory",
    },
    type: [{ coding: [coding(SNOMED, "185349003", "Encounter for check up")] }],
    subject: { reference: subject },
    period: { start: "2026-01-01T09:00:00Z", end: "2026-01-01T09:30:00Z" },
    serviceProvider: { reference: `Organization/ORG-${pad(i % 13, 3)}` },
  };
}

/** A Condition on the problem list. */
function condition(i, id, subject, enc) {
  return {
    resourceType: "Condition",
    id,
    clinicalStatus: {
      coding: [
        coding("http://terminology.hl7.org/CodeSystem/condition-clinical", "active", "Active"),
      ],
    },
    verificationStatus: {
      coding: [
        coding(
          "http://terminology.hl7.org/CodeSystem/condition-ver-status",
          "confirmed",
          "Confirmed",
        ),
      ],
    },
    category: [
      {
        coding: [
          coding(
            "http://terminology.hl7.org/CodeSystem/condition-category",
            "problem-list-item",
            "Problem List Item",
          ),
        ],
      },
    ],
    code: { coding: [coding(SNOMED, "38341003", "Hypertensive disorder")] },
    subject: { reference: subject },
    encounter: { reference: enc },
    onsetDateTime: "2025-06-01",
    recordedDate: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
  };
}

/** A MedicationRequest with a dosage, the dose quantity the quantity layer reads. */
function medicationRequest(i, id, subject) {
  return {
    resourceType: "MedicationRequest",
    id,
    status: "active",
    intent: "order",
    medicationCodeableConcept: {
      coding: [coding(RXNORM, "314076", "lisinopril 10 MG Oral Tablet")],
    },
    subject: { reference: subject },
    authoredOn: "2026-01-01",
    dosageInstruction: [
      {
        sequence: 1,
        text: "one tablet by mouth daily",
        timing: { repeat: { frequency: 1, period: 1, periodUnit: "d" } },
        route: { coding: [coding(SNOMED, "26643006", "Oral route")] },
        doseAndRate: [
          {
            doseQuantity: { value: 1 + (i % 2), unit: "tablet", system: UCUM, code: "{tbl}" },
          },
        ],
      },
    ],
  };
}

/** A vital-signs Observation, the resource a feed carries all day: about 1.5 KiB of JSON. */
export function observation(i) {
  return JSON.stringify(bloodPressure(i, `OBS-${pad(i)}`, `Patient/PAT-${pad(i)}`));
}

/**
 * A transaction Bundle of `entries` entries. Every fifth entry starts a new patient; the four after
 * it are that patient's Encounter, Condition, Observation and MedicationRequest, each pointing at the
 * patient (and the Condition at the Encounter) by `urn:uuid`, as a transaction does before the
 * server assigns ids. One entry to a line, so a reader of the text can count them.
 */
export function transactionBundle(i, entries) {
  const lines = [];
  let subject = "";
  let enc = "";
  for (let k = 0; k < entries; k++) {
    const fullUrl = uuid(i, k);
    let resource;
    switch (k % 5) {
      case 0:
        subject = fullUrl;
        resource = patient(i + k, undefined);
        break;
      case 1:
        enc = fullUrl;
        resource = encounter(i + k, undefined, subject);
        break;
      case 2:
        resource = condition(i + k, undefined, subject, enc);
        break;
      case 3:
        resource = bloodPressure(i + k, undefined, subject);
        break;
      default:
        resource = medicationRequest(i + k, undefined, subject);
    }
    const entry = { fullUrl, resource, request: { method: "POST", url: resource.resourceType } };
    lines.push(JSON.stringify(entry));
  }
  return (
    `{"resourceType":"Bundle","id":"TXN-${pad(i)}","type":"transaction",` +
    `"timestamp":"2026-01-01T09:00:00Z","entry":[\n${lines.join(",\n")}\n]}`
  );
}

/**
 * A searchset page: `matches` Observations, alternating blood pressure and body weight, over ten
 * patients, each patient included once, with the paging links and `total` a server sends.
 */
export function searchsetBundle(i, matches) {
  const base = "https://fhir.example.org/r4";
  const entries = [];
  const patients = Math.min(10, matches);
  for (let k = 0; k < matches; k++) {
    const id = `OBS-${pad(i)}-${pad(k)}`;
    const subject = `Patient/PAT-${pad(i)}-${pad(k % patients, 2)}`;
    const resource = k % 2 === 0 ? bloodPressure(k, id, subject) : bodyWeight(k, id, subject);
    entries.push({
      fullUrl: `${base}/Observation/${id}`,
      resource,
      search: { mode: "match", score: 1 },
    });
  }
  for (let p = 0; p < patients; p++) {
    const id = `PAT-${pad(i)}-${pad(p, 2)}`;
    entries.push({
      fullUrl: `${base}/Patient/${id}`,
      resource: patient(i + p, id),
      search: { mode: "include" },
    });
  }
  return JSON.stringify({
    resourceType: "Bundle",
    id: `SRCH-${pad(i)}`,
    meta: { lastUpdated: "2026-01-01T09:00:00.000Z" },
    type: "searchset",
    total: matches * 20,
    link: [
      { relation: "self", url: `${base}/Observation?category=vital-signs&_count=${matches}` },
      {
        relation: "next",
        url: `${base}/Observation?category=vital-signs&_page_token=SYN${pad(i)}`,
      },
    ],
    entry: entries,
  });
}

/** An extension nested `depth` levels: an extension of an extension of ..., ending in a value. */
function nestedExtension(depth, k) {
  if (depth === 0) {
    return {
      url: `http://example.org/fhir/StructureDefinition/leaf-${String(k % 7)}`,
      valueString: "synthetic",
    };
  }
  return {
    url: `http://example.org/fhir/StructureDefinition/level-${String(depth)}`,
    extension: [nestedExtension(depth - 1, k), nestedExtension(depth - 1, k + 1)],
  };
}

/**
 * A Patient deep and wide at once: 8 names, identifiers, telecoms and addresses; a tree of extensions
 * 6 levels deep (127 nodes); and `contained` resources, cycling through an Observation, a Condition
 * and a MedicationRequest, each of the Observations carrying its own extension tree, every contained
 * resource referenced from the Patient's `generalPractitioner` or `link`, as an inlined chart is.
 */
export function containedPatient(i, contained) {
  const root = patient(i, `PAT-${pad(i)}`, 8);
  const resources = [];
  for (let k = 0; k < contained; k++) {
    const id = `c${String(k)}`;
    switch (k % 3) {
      case 0:
        // No `meta`: a contained resource may not carry a versionId or lastUpdated (dom-4).
        resources.push({
          ...bloodPressure(i + k, id, "#"),
          meta: undefined,
          extension: [nestedExtension(3, k)],
        });
        break;
      case 1:
        resources.push(condition(i + k, id, "#", `Encounter/ENC-${pad(i)}`));
        break;
      default:
        resources.push(medicationRequest(i + k, id, "#"));
    }
  }
  return JSON.stringify({
    resourceType: "Patient",
    id: root.id,
    meta: root.meta,
    contained: resources,
    extension: [nestedExtension(6, i)],
    identifier: root.identifier,
    active: true,
    name: root.name,
    telecom: root.telecom,
    gender: root.gender,
    birthDate: root.birthDate,
    address: root.address,
    generalPractitioner: resources.map((_r, k) => ({ reference: `#c${String(k)}` })),
  });
}

/** `bytes` bytes of deterministic noise, as base64: the body of a synthetic PDF. */
function base64Payload(i, bytes) {
  const buffer = Buffer.alloc(bytes);
  // xorshift32: incompressible enough to look like a compressed PDF stream, and the same every run.
  let x = (i + 1) * 2654435761;
  for (let b = 0; b < bytes; b++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    buffer[b] = x & 0xff;
  }
  return buffer.toString("base64");
}

/**
 * A DiagnosticReport whose `presentedForm` carries a PDF of `bytes` bytes as base64: the large opaque
 * payload, where one string is nearly the whole document.
 */
export function reportWithAttachment(i, bytes) {
  return JSON.stringify({
    resourceType: "DiagnosticReport",
    id: `DR-${pad(i)}`,
    status: "final",
    category: [
      {
        coding: [coding("http://terminology.hl7.org/CodeSystem/v2-0074", "LAB", "Laboratory")],
      },
    ],
    code: { coding: [coding(LOINC, "58410-2", "CBC panel - Blood by Automated count")] },
    subject: { reference: `Patient/PAT-${pad(i)}` },
    effectiveDateTime: "2026-01-01T09:00:00Z",
    issued: "2026-01-01T10:00:00.000Z",
    presentedForm: [
      {
        contentType: "application/pdf",
        language: "en-US",
        data: base64Payload(i, bytes),
        title: "Synthetic report",
        creation: "2026-01-01T10:00:00Z",
      },
    ],
  });
}

/**
 * A FHIR Binary carrying a PDF of `bytes` bytes as base64 in `data`, as a document server returns
 * one: the large opaque payload with almost nothing around it.
 */
export function binaryResource(i, bytes) {
  return JSON.stringify({
    resourceType: "Binary",
    id: `BIN-${pad(i)}`,
    contentType: "application/pdf",
    data: base64Payload(i, bytes),
  });
}

export { KIB };
