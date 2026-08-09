/**
 * FHIR XML codec (xml.html), read (parse) and write (serialize) between FHIR XML and the
 * shared {@link ../model/node.js FhirNode} model, plus cross-format equivalence.
 *
 * Zero-dependency and hardened: the reader ({@link ./raw-xml.js}) is XXE- and billion-laughs-proof by
 * **refusing** any DTD and any non-predefined entity ({@link ./issues.js}), never resolving a URI or
 * expanding an entity. {@link ./read.js parseResourceXml} reads into the shared model,
 * {@link ./write.js serializeResourceXml} writes that model back and **refuses** rather than emit a
 * document a finding would not survive, and {@link ./equivalence.js nodesEquivalent} is the JSON↔XML
 * model-equivalence oracle.
 *
 * **The two readers do not build an identical model, and the difference is a primitive's lexical
 * form.** XML carries every primitive as the text of its `value` attribute and this reader is
 * schema-free, so `<active value="true"/>` is the string `"true"` where JSON gives a `boolean`, and
 * `<value value="1.50"/>` is the string `"1.50"` where JSON gives a `FhirDecimal`. Precision is
 * preserved on both paths (no `number` is involved either way) and the two compare equivalent, but a
 * consumer that keys on the model shape sees the difference: re-serializing to JSON quotes the
 * number, and the datatype validator reads it as a type mismatch. `nodesEquivalent` states the rule;
 * read it there rather than from a summary here.
 *
 * **The writer's output is not unconditionally spec-clean and its round trip is not unconditionally
 * byte-for-byte**, and both used to be asserted here without a qualifier. A property name carrying a
 * prefix is written with no declaration to bind it (`<v:x value="1"/>`), and a name that is not a
 * conformant XML name at all is written verbatim (`<a&b/>`, `<1abc/>`); a narrative `<div>x</div>`
 * comes back as `<div xmlns="http://hl7.org/fhir">x</div>`. The exceptions and the refusals are
 * enumerated on `serializeResourceXml` itself; read them there rather than from a summary here.
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
