/**
 * The narrative layer: `Narrative.div` read as XHTML and checked against the R4 narrative rules.
 *
 * Before this layer the narrative was carried as an opaque string and never checked, so a `script`
 * element, an `onclick` handler or a `<form>` in a narrative passed validation. These tests pin each
 * rule, the locations it reports at, that every finding is value-free, that the check never throws
 * in either mode, and that the string is kept exactly as the document wrote it.
 *
 * Every narrative here is synthetic.
 */

import { describe, expect, it } from "vitest";

import {
  parseResource,
  parseResourceXml,
  serializeResource,
  serializeResourceXml,
  validateResource,
  VALIDATION_CODES,
  type FhirComplex,
  type ValidationIssue,
} from "../src/index.js";

const XHTML = "http://www.w3.org/1999/xhtml";

/** A Patient whose narrative `div` is `div`, as JSON text. */
function patientWith(div: unknown): string {
  return JSON.stringify({ resourceType: "Patient", text: { status: "generated", div } });
}

/** A narrative in the XHTML namespace around `inner`. */
function xhtml(inner: string): string {
  return `<div xmlns="${XHTML}">${inner}</div>`;
}

/** The narrative findings for a Patient whose narrative `div` is `div`, as `code expression`. */
function narrativeFindings(div: unknown, mode: "lenient" | "strict" = "lenient"): string[] {
  const { resource } = parseResource(patientWith(div));
  return narrativeOf(validateResource(resource, { mode }).issues);
}

/** The narrative findings among `issues`, as `code expression`. */
function narrativeOf(issues: readonly ValidationIssue[]): string[] {
  return issues
    .filter((i) => i.code.startsWith("NARRATIVE_"))
    .map((i) => `${i.code} ${i.expression}`);
}

/** The single code each narrative finding for `div` carries. */
function codes(div: unknown): string[] {
  return narrativeFindings(div).map((line) => line.split(" ")[0] as string);
}

describe("a conformant narrative draws no narrative finding", () => {
  it.each([
    ["a paragraph", xhtml("<p>Synthetic narrative</p>")],
    ["text directly in the div", xhtml("Synthetic narrative")],
    [
      "a table with its attributes",
      xhtml('<table border="1"><tr><td colspan="2">x</td></tr></table>'),
    ],
    [
      "a link and a named anchor",
      xhtml('<a href="https://example.org/x">x</a><a name="top">t</a>'),
    ],
    ["an image with its attributes", xhtml('<img src="#img1" alt="diagram" width="10"/>')],
    ["the xml attributes", xhtml('<p xml:lang="en" xml:space="preserve" lang="en">x</p>')],
    ["the global attributes", xhtml('<span class="c" id="i" style="color:red" title="t">x</span>')],
    ["a list inside a div", xhtml("<div><ul><li>a</li></ul><ol><li>b</li></ol></div>")],
    ["inline elements inside a paragraph", xhtml("<p><b>a</b><i>b</i><span>c</span><br/></p>")],
    ["a predefined entity and a character reference", xhtml("<p>a &amp; b &#233; &#x41;</p>")],
    ["a comment and a processing instruction", xhtml("<!-- note --><?pi x?><p>x</p>")],
    [
      "a prefixed spelling of the XHTML namespace",
      `<h:div xmlns:h="${XHTML}"><h:p>x</h:p></h:div>`,
    ],
    ["an XML declaration before the root", `<?xml version="1.0"?>${xhtml("x")}`],
    [
      "a root declaring two namespaces",
      `<div xmlns="${XHTML}" xmlns:h="${XHTML}"><h:p>x</h:p></div>`,
    ],
  ])("%s", (_name, div) => {
    expect(narrativeFindings(div)).toEqual([]);
  });

  it("leaves a resource with no narrative, or a div with no value, alone", () => {
    expect(narrativeFindings(undefined)).toEqual([]);
    const { resource } = parseResource(
      '{"resourceType":"Patient","text":{"status":"generated","_div":{"id":"d1"}}}',
    );
    expect(narrativeOf(validateResource(resource).issues)).toEqual([]);
  });

  it("leaves a narrative with no div, and a text or contained entry that is not an object, alone", () => {
    for (const text of [
      '{"resourceType":"Patient","text":{"status":"generated"}}',
      '{"resourceType":"Patient","text":"not a narrative"}',
      '{"resourceType":"Patient","contained":["not a resource"]}',
    ]) {
      expect(narrativeOf(validateResource(parseResource(text).resource).issues)).toEqual([]);
    }
  });
});

describe("active content is reported as NARRATIVE_ACTIVE_CONTENT and fails validation", () => {
  it.each([
    ["a script element", xhtml("<p>x</p><script>alert(1)</script>")],
    ["an upper-case script element", xhtml("<p>x</p><SCRIPT>alert(1)</SCRIPT>")],
    ["a script inside an allowed element", xhtml("<p>x<span><script>alert(1)</script></span></p>")],
    ["a script in another namespace", xhtml('<p>x</p><svg xmlns="urn:x"><script>1</script></svg>')],
    ["an empty script", xhtml("<p>x</p><script/>")],
    ["an iframe", xhtml('<p>x</p><iframe src="https://example.org"/>')],
    ["an object", xhtml("<p>x</p><object/>")],
    ["an embed", xhtml("<p>x</p><embed/>")],
    ["an onclick handler", xhtml('<p onclick="alert(1)">x</p>')],
    ["an upper-case handler", xhtml('<p ONMOUSEOVER="alert(1)">x</p>')],
    ["a handler on an image", xhtml('<img src="#a" onerror="alert(1)"/>')],
    ["a javascript link", xhtml('<a href="javascript:alert(1)">x</a>')],
    [
      "a javascript link in mixed case after spaces",
      xhtml('<a href="  JavaScript:alert(1)">x</a>'),
    ],
    [
      "a javascript link written with a character reference",
      xhtml('<a href="&#106;avascript:1">x</a>'),
    ],
    // A browser removes every tab, line feed and carriage return from a URL before it reads the
    // scheme, and the reader keeps a character reference as the character it names.
    [
      "a javascript link with a tab inside the scheme",
      xhtml('<a href="java&#9;script:alert(1)">x</a>'),
    ],
    [
      "a javascript link with a line feed inside the scheme",
      xhtml('<a href="java&#10;script:alert(1)">x</a>'),
    ],
    [
      "a javascript link with a carriage return inside the scheme",
      xhtml('<a href="java&#13;script:alert(1)">x</a>'),
    ],
    [
      "a javascript image-map area with a hex tab inside the scheme",
      xhtml('<map name="m"><area href="jav&#x9;ascript:alert(1)" alt="z"/></map>x'),
    ],
    [
      "a vbscript image with a line feed before the colon",
      xhtml('<img src="vbscript&#10;:msgbox(1)"/>'),
    ],
    ["a vbscript image", xhtml('<img src="vbscript:msgbox(1)"/>')],
    ["a javascript citation", xhtml('<q cite="javascript:1">x</q>')],
  ])("%s", (_name, div) => {
    const { resource } = parseResource(patientWith(div));
    const result = validateResource(resource);
    expect(codes(div)).toContain("NARRATIVE_ACTIVE_CONTENT");
    expect(result.valid).toBe(false);
  });

  it("reports a script as active content, not also as an illegal element", () => {
    expect(codes(xhtml("<p>x</p><script>1</script>"))).toEqual(["NARRATIVE_ACTIVE_CONTENT"]);
  });

  it("reports a handler as active content, not also as an illegal attribute", () => {
    expect(codes(xhtml('<p onclick="1">x</p>'))).toEqual(["NARRATIVE_ACTIVE_CONTENT"]);
  });

  it("carries the R4 security issue type", () => {
    const { resource } = parseResource(patientWith(xhtml("<p>x</p><script>1</script>")));
    const issue = validateResource(resource).issues.find(
      (i) => i.code === "NARRATIVE_ACTIVE_CONTENT",
    );
    expect(issue).toMatchObject({ severity: "error", type: "security" });
  });
});

describe("elements and attributes outside the R4 set", () => {
  it.each([
    ["a font element", xhtml("<font>x</font>")],
    ["a form", xhtml("<form><p>x</p></form>")],
    ["an input", xhtml("<p>x<input/></p>")],
    ["a style element", xhtml("<style>p{}</style><p>x</p>")],
    ["an upper-case P, since XHTML is case-sensitive", xhtml("<P>x</P>")],
    ["an element taken out of the XHTML namespace", xhtml('<p xmlns="">x</p>')],
    ["an element in another namespace", xhtml('<v:p xmlns:v="urn:x">x</v:p>')],
    ["an element whose prefix nothing binds", xhtml("<v:p>x</v:p>")],
  ])("%s is NARRATIVE_ELEMENT_ILLEGAL", (_name, div) => {
    expect(codes(div)).toContain("NARRATIVE_ELEMENT_ILLEGAL");
  });

  it.each([
    ["a data attribute", xhtml('<p data-x="1">x</p>')],
    ["an href on a paragraph", xhtml('<p href="https://example.org">x</p>')],
    ["a src on a link", xhtml('<a src="https://example.org">x</a>')],
    ["a prefixed attribute", xhtml('<a xmlns:xl="urn:x" xl:href="#a">x</a>')],
    ["an upper-case attribute", xhtml('<p CLASS="c">x</p>')],
  ])("%s is NARRATIVE_ATTRIBUTE_ILLEGAL", (_name, div) => {
    expect(codes(div)).toEqual(["NARRATIVE_ATTRIBUTE_ILLEGAL"]);
  });
});

describe("the root must be a div in the XHTML namespace", () => {
  it.each([
    ["no namespace", "<div><p>x</p></div>"],
    ["another namespace", '<div xmlns="urn:x"><p>x</p></div>'],
    ["the FHIR namespace", '<div xmlns="http://hl7.org/fhir"><p>x</p></div>'],
    ["a paragraph root", `<p xmlns="${XHTML}">x</p>`],
    ["an upper-case DIV", `<DIV xmlns="${XHTML}">x</DIV>`],
  ])("%s is NARRATIVE_ROOT_INVALID", (_name, div) => {
    expect(codes(div)).toContain("NARRATIVE_ROOT_INVALID");
  });

  it("checks the elements under a root with no namespace as outside XHTML too", () => {
    expect(codes("<div><p>x</p></div>")).toEqual([
      "NARRATIVE_ROOT_INVALID",
      "NARRATIVE_ELEMENT_ILLEGAL",
    ]);
  });
});

describe("a block element inside a paragraph", () => {
  it.each([
    ["a div", xhtml("<p>x<div>y</div></p>")],
    ["a paragraph", xhtml("<p>x<p>y</p></p>")],
    ["a table", xhtml("<p>x<table><tr><td>y</td></tr></table></p>")],
    ["a list under an inline element", xhtml("<p>x<span><ul><li>y</li></ul></span></p>")],
    ["a blockquote", xhtml("<p>x<blockquote>y</blockquote></p>")],
  ])("%s is NARRATIVE_BLOCK_IN_PARAGRAPH", (_name, div) => {
    expect(codes(div)).toEqual(["NARRATIVE_BLOCK_IN_PARAGRAPH"]);
  });
});

describe("a narrative with no content", () => {
  it.each([
    ["an empty div", xhtml("")],
    ["a self-closing div", `<div xmlns="${XHTML}"/>`],
    ["whitespace only", xhtml(" \n\t\r ")],
    ["empty elements only", xhtml("<p> </p><span/><br/>")],
    ["a comment only", xhtml("<!-- note -->")],
  ])("%s is NARRATIVE_EMPTY", (_name, div) => {
    expect(codes(div)).toEqual(["NARRATIVE_EMPTY"]);
  });

  it.each([
    ["an image", xhtml('<img src="#a"/>')],
    ["a no-break space by reference", xhtml("<p>&#160;</p>")],
    ["one character deep inside", xhtml("<p><span><b>x</b></span></p>")],
  ])("%s is content", (_name, div) => {
    expect(codes(div)).toEqual([]);
  });
});

describe("a narrative that cannot be read is NARRATIVE_UNREADABLE and nothing more", () => {
  it.each([
    ["not XML", "plain text, no markup"],
    ["an unclosed element", `<div xmlns="${XHTML}"><p>x</div>`],
    ["two roots", `${xhtml("x")}${xhtml("y")}`],
    ["an HTML named entity", xhtml("<p>a&nbsp;b</p>")],
    ["an undefined entity", xhtml("<p>&sentinel;</p>")],
    ["a DTD", `<!DOCTYPE div [<!ENTITY a "b">]>${xhtml("&a;")}`],
    ["a CDATA section", xhtml("<p><![CDATA[x]]></p>")],
    ["a bare ampersand", xhtml("<p>a & b</p>")],
    ["the empty string", ""],
    ["nesting past the reader's bound", xhtml(`${"<span>".repeat(400)}x${"</span>".repeat(400)}`)],
  ])("%s", (_name, div) => {
    expect(codes(div)).toEqual(["NARRATIVE_UNREADABLE"]);
  });

  it("a div that is not a string", () => {
    expect(codes(42)).toEqual(["NARRATIVE_UNREADABLE"]);
    expect(codes({ p: "x" })).toEqual(["NARRATIVE_UNREADABLE"]);
  });
});

describe("where the narrative layer looks", () => {
  it("reports at the location of the div, and each code once per narrative", () => {
    const div = xhtml('<p onclick="1">x</p><script>1</script><font>a</font><font>b</font>');
    expect(narrativeFindings(div)).toEqual([
      "NARRATIVE_ACTIVE_CONTENT Patient.text.div",
      "NARRATIVE_ELEMENT_ILLEGAL Patient.text.div",
    ]);
  });

  it("reads the narrative of a contained resource", () => {
    const { resource } = parseResource(
      JSON.stringify({
        resourceType: "Patient",
        text: { status: "generated", div: xhtml("x") },
        contained: [
          { resourceType: "Organization", id: "o1", text: { status: "generated", div: xhtml("") } },
        ],
      }),
    );
    expect(narrativeOf(validateResource(resource).issues)).toEqual([
      "NARRATIVE_EMPTY Patient.contained[0].text.div",
    ]);
  });

  it("reads the narrative of every Bundle entry, and of a response outcome", () => {
    const { resource } = parseResource(
      JSON.stringify({
        resourceType: "Bundle",
        type: "collection",
        entry: [
          { resource: { resourceType: "Patient", text: { status: "generated", div: xhtml("x") } } },
          {
            resource: {
              resourceType: "Observation",
              status: "final",
              code: { text: "x" },
              text: { status: "generated", div: xhtml("<script>1</script>") },
            },
            response: {
              status: "200",
              outcome: {
                resourceType: "OperationOutcome",
                text: { status: "generated", div: "<div>x</div>" },
              },
            },
          },
        ],
      }),
    );
    expect(narrativeOf(validateResource(resource).issues)).toEqual([
      "NARRATIVE_ACTIVE_CONTENT Bundle.entry[1].resource.text.div",
      "NARRATIVE_ROOT_INVALID Bundle.entry[1].response.outcome.text.div",
    ]);
  });

  it("reads a resource in a Parameters parameter and in a nested part", () => {
    const { resource } = parseResource(
      JSON.stringify({
        resourceType: "Parameters",
        parameter: [
          {
            name: "a",
            resource: { resourceType: "Patient", text: { status: "generated", div: xhtml("") } },
          },
          {
            name: "b",
            part: [
              {
                name: "c",
                resource: {
                  resourceType: "Patient",
                  text: { status: "generated", div: xhtml("<font>x</font>") },
                },
              },
            ],
          },
        ],
      }),
    );
    expect(narrativeOf(validateResource(resource).issues)).toEqual([
      "NARRATIVE_EMPTY Parameters.parameter[0].resource.text.div",
      "NARRATIVE_ELEMENT_ILLEGAL Parameters.parameter[1].part[0].resource.text.div",
    ]);
  });

  it("reads the narrative of a resource type with no built-in schema", () => {
    const { resource } = parseResource(
      JSON.stringify({
        resourceType: "EventDefinition",
        text: { status: "generated", div: xhtml("\n    ") },
      }),
    );
    expect(narrativeOf(validateResource(resource).issues)).toEqual([
      "NARRATIVE_EMPTY EventDefinition.text.div",
    ]);
  });

  it("reads a narrative that arrived as XML, in either spelling of the namespace", () => {
    const fhir = 'xmlns="http://hl7.org/fhir"';
    const clean = parseResourceXml(
      `<Patient ${fhir} xmlns:h="${XHTML}"><text><status value="generated"/><h:div><h:p>x</h:p></h:div></text></Patient>`,
    ).resource;
    expect(narrativeOf(validateResource(clean).issues)).toEqual([]);
    const hostile = parseResourceXml(
      `<Patient ${fhir}><text><status value="generated"/><div xmlns="${XHTML}"><p onclick="1">x</p></div></text></Patient>`,
    ).resource;
    expect(narrativeOf(validateResource(hostile).issues)).toEqual([
      "NARRATIVE_ACTIVE_CONTENT Patient.text.div",
    ]);
  });
});

describe("the check never throws, never echoes content, and never changes the narrative", () => {
  const SENTINEL = "Zzyxxnarrativesentinel";
  const hostile = [
    xhtml(`<p onclick="${SENTINEL}">${SENTINEL}</p><script>${SENTINEL}</script>`),
    xhtml(`<${SENTINEL}>x</${SENTINEL}>`),
    xhtml(`<p ${SENTINEL}="x">x</p>`),
    xhtml(`<p>&${SENTINEL};</p>`),
    `<${SENTINEL}>x</${SENTINEL}>`,
    `${SENTINEL} <div>`,
  ];

  it.each(hostile.map((div, i) => [i, div]))("hostile narrative #%s", (_i, div) => {
    const text = patientWith(div);
    const { resource } = parseResource(text);
    for (const mode of ["lenient", "strict"] as const) {
      const result = validateResource(resource, { mode });
      expect(narrativeOf(result.issues).length).toBeGreaterThan(0);
      const surface =
        JSON.stringify(result.issues) + serializeResource(result.toOperationOutcome());
      expect(surface).not.toContain(SENTINEL);
    }
    // The model still holds the string as written, and the writers emit it unchanged.
    const textNode = resource.properties.find((p) => p.name === "text")?.value as FhirComplex;
    const divNode = textNode.properties.find((p) => p.name === "div")?.value;
    expect(divNode).toMatchObject({ kind: "primitive", value: div });
    expect(serializeResource(resource)).toBe(text);
  });

  it("keeps an XML-read narrative byte for byte through validation and the XML writer", () => {
    const div = `<div xmlns="${XHTML}"><p onclick="x">a<script>b</script></p></div>`;
    const xml = `<Patient xmlns="http://hl7.org/fhir"><text><status value="generated"/>${div}</text></Patient>`;
    const { resource } = parseResourceXml(xml);
    const before = serializeResourceXml(resource);
    validateResource(resource);
    expect(serializeResourceXml(resource)).toBe(before);
    expect(before).toContain(div);
  });

  it("registers every narrative code", () => {
    const narrative = Object.keys(VALIDATION_CODES).filter((c) => c.startsWith("NARRATIVE_"));
    expect(narrative.sort()).toEqual([
      "NARRATIVE_ACTIVE_CONTENT",
      "NARRATIVE_ATTRIBUTE_ILLEGAL",
      "NARRATIVE_BLOCK_IN_PARAGRAPH",
      "NARRATIVE_ELEMENT_ILLEGAL",
      "NARRATIVE_EMPTY",
      "NARRATIVE_ROOT_INVALID",
      "NARRATIVE_UNREADABLE",
    ]);
  });
});
