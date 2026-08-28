import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { isList, list, parseResource, primitive } from "../src/index.js";
import type { FhirNode } from "../src/index.js";

/**
 * The model's **edge set**, derived rather than described.
 *
 * A consumer that walks a resource reaches a node by following a member of another node. So the set
 * of positions any walker can observe is exactly the transitive closure of the node-valued members
 * of `FhirNode`, and `FhirNode` is a closed three-way union. Enumerating every declared member of
 * those three interfaces and classifying each one therefore enumerates the whole graph: there is no
 * fourth case to have missed, and the enumeration cannot be made stale by a new consumer, only by a
 * new member.
 *
 * That is the guarantee this file exists to hold. Content the reader preserves at a position FHIR
 * gives no meaning to (an array inside an array) is kept as **text**, not as an element, so it adds
 * no edge and no walk can reach it. Two previous attempts to fix the same data loss added an edge
 * instead, and both were refuted for the same reason: a list holding a list reaches sites that
 * flatten a list into its items and then drop, or miscount, whatever is not the kind they expect, so
 * a profile invariant, a vital-signs unit check or a negation goes unevaluated and the resource then
 * reads as valid. The failure is silent and it points at `valid: true`, which is the one direction
 * this package must never move in.
 *
 * Adding a node-valued member to the model is allowed. Adding one **without** revisiting every
 * flattening consumer is what these tests make impossible to do by accident.
 */

const SRC = new URL("../src/", import.meta.url).pathname;
const NODE_TS = join(SRC, "model/node.ts");

/** Every `.ts` file under `src/`, so the reference census cannot miss a directory. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** The declared members of one interface in `model/node.ts`, as `name -> type text`. */
function membersOf(name: string): Map<string, string> {
  const text = readFileSync(NODE_TS, "utf8");
  const file = ts.createSourceFile(NODE_TS, text, ts.ScriptTarget.ES2022, true);
  const found = new Map<string, string>();
  let seen = false;
  for (const statement of file.statements) {
    if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== name) continue;
    seen = true;
    for (const member of statement.members) {
      if (!ts.isPropertySignature(member) || member.type === undefined) continue;
      found.set(member.name.getText(file), member.type.getText(file));
    }
  }
  expect(seen, `interface ${name} should exist in model/node.ts`).toBe(true);
  return found;
}

/** The model's node types. A member whose type mentions one of these carries an edge. */
const NODE_TYPES = ["FhirNode", "FhirComplex", "FhirList", "FhirPrimitive", "FhirProperty"];

describe("the model's edge set is derived from the type, not from a search", () => {
  it("enumerates every declared member of the three node kinds", () => {
    // The union is closed, so this is the whole model surface. If a fourth node kind is ever added
    // this assertion is where it has to be declared.
    const kinds = ["FhirComplex", "FhirList", "FhirPrimitive"];
    const declared = new Map<string, string>();
    for (const kind of kinds) {
      for (const [member, type] of membersOf(kind)) declared.set(`${kind}.${member}`, type);
    }
    expect([...declared.keys()].sort()).toEqual([
      "FhirComplex.droppedText",
      "FhirComplex.duplicates",
      "FhirComplex.foreignRoot",
      "FhirComplex.kind",
      "FhirComplex.nestedArray",
      "FhirComplex.nestedArraySource",
      "FhirComplex.nonObjectSource",
      "FhirComplex.properties",
      "FhirList.items",
      "FhirList.kind",
      "FhirPrimitive.droppedText",
      "FhirPrimitive.extension",
      "FhirPrimitive.id",
      "FhirPrimitive.kind",
      "FhirPrimitive.nestedArray",
      "FhirPrimitive.nestedArrayMetaSource",
      "FhirPrimitive.nestedArraySource",
      "FhirPrimitive.nonObjectMetaSource",
      "FhirPrimitive.undefinedNull",
      "FhirPrimitive.value",
    ]);
  });

  it("finds exactly four node-valued members, so a walk can reach nothing else", () => {
    const edges: string[] = [];
    for (const kind of ["FhirComplex", "FhirList", "FhirPrimitive"]) {
      for (const [member, type] of membersOf(kind)) {
        if (NODE_TYPES.some((node) => new RegExp(`\\b${node}\\b`).test(type))) {
          edges.push(`${kind}.${member}`);
        }
      }
    }
    // These four are the entire node graph. Every consumer in the package reaches a node through one
    // of them, so auditing them audits every walk there is.
    expect(edges.sort()).toEqual([
      "FhirComplex.duplicates",
      "FhirComplex.properties",
      "FhirList.items",
      "FhirPrimitive.extension",
    ]);
  });

  it("types the preserved nested-array content as a string, which carries no edge", () => {
    // This is the load-bearing property of the whole design. A string cannot be a list item, cannot
    // be a property value, and cannot be an extension, so no walker can observe it however it
    // recurses. Preservation therefore costs the walkers nothing.
    expect(membersOf("FhirComplex").get("nestedArraySource")).toBe("string");
    expect(membersOf("FhirPrimitive").get("nestedArraySource")).toBe("string");
    expect(membersOf("FhirPrimitive").get("nestedArrayMetaSource")).toBe("string");
  });

  it("types the dropped-element-text marker as `true`, which carries no edge and no content", () => {
    // The marker records that the reader dropped character data at this position. It is a literal
    // `true`, not a string: unlike the nested-array text nothing is preserved, so there is no
    // content here for a walker to reach and none for a diagnostic to leak.
    expect(membersOf("FhirComplex").get("droppedText")).toBe("true");
    expect(membersOf("FhirPrimitive").get("droppedText")).toBe("true");
  });

  it("types the undefined-`null` marker as `true`, which carries no edge and no content", () => {
    // A `null` has nothing to preserve, so like the dropped-text marker this is a literal `true`
    // rather than a source string. It changes what the writer emits at the position and nothing a
    // walker can observe: the node is still the value-absent primitive it always was.
    expect(membersOf("FhirPrimitive").get("undefinedNull")).toBe("true");
    // It exists on the primitive only. A `null` written where FHIR JSON has an object is the
    // neighbouring case and is handled by `FhirComplex.nonObjectSource`, unchanged.
    expect(membersOf("FhirComplex").has("undefinedNull")).toBe(false);
  });

  it("can only set the undefined-`null` marker through the JSON reader's own helper", () => {
    // Same closure as the two markers above: nothing else in the package marks a node, so the
    // marker can only ever mean that a document wrote a `null` that padded nothing at that
    // position, and the writer can never be made to emit a `null` no document carried.
    expect(
      sourceFiles(SRC)
        .filter((file) => /markUndefinedNull/.test(readFileSync(file, "utf8")))
        .map((file) => file.slice(SRC.length))
        .sort(),
    ).toEqual(["codec/read.ts", "model/node.ts"]);
  });

  it("types the foreign-root marker as `true`, which carries no edge and no content", () => {
    // The marker records that the document's root named a vocabulary other than FHIR's. Like the
    // two above it, a literal `true` and not the namespace: the namespace URI is document content,
    // so preserving it would put a vendor URI on the model within reach of a diagnostic. Nothing is
    // kept, so there is nothing here for a walker to reach and nothing for a diagnostic to leak.
    expect(membersOf("FhirComplex").get("foreignRoot")).toBe("true");
    // On the complex only. A root is an object element, and the primitive has no root position to
    // read a vocabulary at.
    expect(membersOf("FhirPrimitive").has("foreignRoot")).toBe(false);
  });

  it("can only set the foreign-root marker through the XML reader's own helper", () => {
    // Same closure as the three markers above: nothing else in the package marks a node, so the
    // marker can only ever mean that a document's own root resolved to another vocabulary, and the
    // XML writer can never be made to refuse a document that did not carry that shape.
    expect(
      sourceFiles(SRC)
        .filter((file) => /markForeignRoot/.test(readFileSync(file, "utf8")))
        .map((file) => file.slice(SRC.length))
        .sort(),
    ).toEqual(["model/node.ts", "xml/read.ts"]);
  });

  it("can only set the dropped-element-text marker through the XML reader's own helper", () => {
    // Same closure as `markNestedArray`: nothing else in the package marks a node, so the marker can
    // only ever mean that a document carried character data at that position.
    expect(
      sourceFiles(SRC)
        .filter((file) => /markDroppedText/.test(readFileSync(file, "utf8")))
        .map((file) => file.slice(SRC.length))
        .sort(),
    ).toEqual(["model/node.ts", "xml/read.ts"]);
  });
});

describe("the preserved text has exactly the consumers it was audited with", () => {
  /** Which files under `src/` mention `pattern` at all. A census of everything, not a sample. */
  function referencing(pattern: RegExp): string[] {
    return sourceFiles(SRC)
      .filter((file) => pattern.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(SRC.length))
      .sort();
  }

  it("can only be set through the reader's own helper", () => {
    // Nothing else in the package constructs a marked node, so the preserved text can only ever be
    // what a document actually carried at that position.
    expect(referencing(/markNestedArray/)).toEqual(["codec/read.ts", "model/node.ts"]);
  });

  it("is read by name in exactly the places it was audited with, and no other", () => {
    // The point is not that these files are correct, it is that no unaudited file has quietly
    // started reading the field: a consumer that did would be interpreting content this package
    // deliberately does not interpret. `codec/read.ts` is absent on purpose, it sets the text
    // through the helper above and never reads it back. No count is asserted in this sentence,
    // because the list below is the assertion and a count beside it is a second thing to keep true.
    expect(referencing(/nestedArray(Meta)?Source/)).toEqual([
      "codec/serialize-guard.ts", // tests for its PRESENCE and refuses; it never reads the text
      "codec/write.ts", // emits it verbatim, so a round trip neither invents nor drops an element
      "model/node.ts", // declares it and hands it back through `nestedArrayContent`
      "xml/equivalence.ts", // compares it, so two documents nesting different content are not equal
    ]);
  });
});

describe("the reader never puts a list inside a list", () => {
  /** Every node in a tree, so the check is over the whole document rather than its root. */
  function everyNode(node: FhirNode, out: FhirNode[] = []): FhirNode[] {
    out.push(node);
    if (node.kind === "list") for (const item of node.items) everyNode(item, out);
    else if (node.kind === "complex") {
      for (const property of node.properties) everyNode(property.value, out);
      for (const property of node.duplicates ?? []) everyNode(property.value, out);
    } else for (const ext of node.extension ?? []) everyNode(ext, out);
    return out;
  }

  const documents = [
    '{"resourceType":"Patient","name":[[{"family":"Roe"}]]}',
    '{"resourceType":"Patient","name":[{"given":["A",["B"]],"_given":[null,[{"id":"x"}]]}]}',
    '{"resourceType":"Patient","_birthDate":[[{"id":"x"}]]}',
    '{"resourceType":"Patient","birthDate":"1980-01-01","_birthDate":{"extension":[[{"url":"u"}]]}}',
    '{"resourceType":"Observation","status":[["final"]]}',
    '{"resourceType":"Observation","note":[[[["deep"]]]]}',
    '{"resourceType":"Bundle","type":"collection","entry":[[{"resource":{"resourceType":"Patient"}}]]}',
    '{"resourceType":"Patient","name":[{}],"name":[[{"family":"Roe"}]]}',
    '{"resourceType":"Patient","contained":[{"resourceType":"Observation","code":{"coding":[[{"code":"x"}]]}}]}',
  ];

  it("holds for every position of every nesting shape the reader accepts", () => {
    for (const doc of documents) {
      for (const node of everyNode(parseResource(doc).resource)) {
        if (!isList(node)) continue;
        for (const item of node.items) {
          expect(isList(item), `a list item is itself a list, in ${doc}`).toBe(false);
        }
      }
    }
  });

  it("is what the flattening consumers rely on, and a hand-built model can still break it", () => {
    // Stated so the boundary is not mistaken for an impossibility. The public `list()` constructor
    // accepts a list as an item, so a hand-built model can hold a shape no parsed document does. The
    // reader is the guarantee; the constructor is not, and never claimed to be.
    const handBuilt = list([list([primitive("x")])]);
    expect(handBuilt.items.map(isList)).toEqual([true]);
  });
});
