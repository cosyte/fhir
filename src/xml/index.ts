/**
 * FHIR XML codec (Phase 8, xml.html) — read (parse) and write (serialize) between FHIR XML and the
 * shared {@link ../model/node.js FhirNode} model, plus cross-format equivalence.
 *
 * Zero-dependency and hardened: the reader ({@link ./raw-xml.js}) is XXE- and billion-laughs-proof by
 * **refusing** any DTD and any non-predefined entity ({@link ./issues.js}), never resolving a URI or
 * expanding an entity. {@link ./read.js parseResourceXml} produces the same model as the JSON reader,
 * {@link ./write.js serializeResourceXml} emits spec-clean XML (round-tripping byte-for-byte), and
 * {@link ./equivalence.js nodesEquivalent} is the JSON↔XML model-equivalence oracle.
 *
 * @packageDocumentation
 */

export { readRawXml } from "./raw-xml.js";
export type { XmlAttribute, XmlElement, XmlNode, XmlText } from "./raw-xml.js";
export { FhirXmlError, XML_FATAL_CODES } from "./issues.js";
export type { XmlFatalCode } from "./issues.js";
export { FHIR_XML_NAMESPACE, parseResourceXml, XHTML_NAMESPACE } from "./read.js";
export { serializeResourceXml } from "./write.js";
export { nodesEquivalent } from "./equivalence.js";
