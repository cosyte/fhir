import { describe, expect, it } from "vitest";

import {
  getProperty,
  isComplex,
  isPrimitive,
  parseResource,
  parseResourceXml,
  readRawXml,
  readSafety,
  serializeResource,
  serializeResourceXml,
  type FhirComplex,
} from "../src/index.js";
import { req } from "./_util.js";

const FHIR_NS = 'xmlns="http://hl7.org/fhir"';
const XHTML_NS = 'xmlns="http://www.w3.org/1999/xhtml"';

/** The `value` attribute of the root element of a one-element document, as the raw reader hands it back. */
function rawValue(value: string): string | undefined {
  return readRawXml(`<x value="${value}"/>`).attributes.find((a) => a.name === "value")?.value;
}

/** Read an XML resource, failing loudly rather than returning `undefined`. */
function xml(document: string): FhirComplex {
  return req(parseResourceXml(document).resource);
}

/** The string value of a primitive property on a complex, failing loudly if it is not one. */
function stringOf(node: FhirComplex, name: string): unknown {
  const property = req(getProperty(node, name));
  if (!isPrimitive(property)) throw new Error(`${name} is not a primitive`);
  return property.value;
}

/** An Observation whose `valueString` carries the given attribute text. */
function observationWithValue(text: string): string {
  return `<Observation ${FHIR_NS}><status value="final"/><valueString value="${text}"/></Observation>`;
}

/** The `valueString` an XML Observation from {@link observationWithValue} reads as. */
function valueOf(document: string): unknown {
  return stringOf(xml(document), "valueString");
}

/** The narrative string an XML Patient carrying the given `div` reads as. */
function narrativeOf(div: string): unknown {
  const resource = xml(
    `<Patient ${FHIR_NS}><text><status value="generated"/>${div}</text></Patient>`,
  );
  const text = req(getProperty(resource, "text"));
  if (!isComplex(text)) throw new Error("text did not read as a complex");
  return stringOf(text, "div");
}

/**
 * XML 1.0 §3.3.3 attribute-value normalization, which every conformant XML processor applies.
 *
 * Without a DTD (which this reader refuses) every attribute is CDATA, so the rule is: a literal tab,
 * line feed or carriage return becomes a space, a literal CR LF pair becomes one space (§2.11 makes it
 * one line feed first), and a character reference is appended as the character it names. Nothing is
 * trimmed. Before this, a literal tab reached the model as a tab, so this reader and every
 * schema-aware consumer read the same attribute differently.
 */
describe("the raw reader normalizes attribute values", () => {
  it("turns each literal tab, line feed and carriage return into a space", () => {
    expect(rawValue("a\tb")).toBe("a b");
    expect(rawValue("a\nb")).toBe("a b");
    expect(rawValue("a\rb")).toBe("a b");
  });

  it("turns a literal CR LF pair into one space, not two", () => {
    expect(rawValue("a\r\nb")).toBe("a b");
    expect(rawValue("a\r\n\r\nb")).toBe("a  b");
  });

  it("keeps the character a character reference names", () => {
    expect(rawValue("a&#9;b")).toBe("a\tb");
    expect(rawValue("a&#xA;b")).toBe("a\nb");
    expect(rawValue("a&#13;&#10;b")).toBe("a\r\nb");
  });

  it("trims and collapses nothing", () => {
    expect(rawValue("  a  b  ")).toBe("  a  b  ");
    expect(rawValue("\ta\t")).toBe(" a ");
  });

  it("leaves character data alone, since the rule is for attribute values", () => {
    const root = readRawXml("<x>a\tb\nc</x>");
    expect(root.children).toEqual([{ type: "text", value: "a\tb\nc" }]);
  });
});

describe("the FHIR XML reader reads a normalized value", () => {
  it("reads a literal line break in a value attribute as a space", () => {
    expect(valueOf(observationWithValue("Ann\nLee"))).toBe("Ann Lee");
    expect(valueOf(observationWithValue("Ann\r\nLee"))).toBe("Ann Lee");
  });

  it("reads a line feed written as a character reference as a line feed", () => {
    expect(valueOf(observationWithValue("Ann&#10;Lee"))).toBe("Ann\nLee");
  });

  it("round-trips a line feed through its own writer, which writes a character reference", () => {
    const json = '{"resourceType":"Observation","status":"final","valueString":"Ann\\nLee"}';
    const written = serializeResourceXml(req(parseResource(json).resource));

    expect(written).toContain('value="Ann&#10;Lee"');
    expect(serializeResource(xml(written))).toBe(json);
  });

  it("does not change the JSON reader", () => {
    const json = '{"resourceType":"Observation","status":"final","valueString":"Ann\\tLee"}';

    expect(stringOf(req(parseResource(json).resource), "valueString")).toBe("Ann\tLee");
  });

  it("still discloses a code padded with a literal tab, now read as a space", () => {
    const safety = readSafety(
      xml(`<Procedure ${FHIR_NS}><status value="\tnot-done"/></Procedure>`),
    );

    expect(safety.status).toBe(" not-done");
    expect(safety.negations).toEqual([]);
    expect(safety.nearMissNegationCodes).toEqual(["Procedure.status"]);
    expect(safety.safeToSummarize).toBe(false);
  });
});

describe("the narrative keeps what its attributes said", () => {
  it("carries a line feed written as a reference as a reference", () => {
    // Written literally into the narrative string, the line feed would be read as a space by the
    // next XML reader, so the string would no longer say what the source said.
    expect(narrativeOf(`<div ${XHTML_NS}><p title="a&#10;b">x</p></div>`)).toBe(
      `<div ${XHTML_NS}><p title="a&#10;b">x</p></div>`,
    );
  });

  it("carries a literal line break as the space it normalizes to", () => {
    expect(narrativeOf(`<div ${XHTML_NS}><p title="a\nb">x</p></div>`)).toBe(
      `<div ${XHTML_NS}><p title="a b">x</p></div>`,
    );
  });

  it("leaves a JSON narrative string verbatim", () => {
    const div = `<div ${XHTML_NS}><p title="a\nb">x</p></div>`;
    const resource = req(
      parseResource(JSON.stringify({ resourceType: "Patient", text: { status: "generated", div } }))
        .resource,
    );
    const text = req(getProperty(resource, "text"));

    expect(stringOf(isComplex(text) ? text : resource, "div")).toBe(div);
  });
});
