/**
 * fast-check generators for FHIR R4, at `@cosyte/fhir/arbitraries`: spec-clean resources and
 * Bundles, messy JSON and XML text the readers accept, hostile input, and the values a codec gets
 * wrong (decimals and strings). We use them to test this library, and you can use them to test
 * code you build on it.
 *
 * `fast-check` is an optional peer dependency: install it to use this entry point. The main entry
 * point, `@cosyte/fhir`, never loads it.
 *
 * Every generated value is synthetic and random. Nothing in one looks like a patient's name, date
 * of birth, address or identifier.
 *
 * @example
 * ```ts
 * import fc from "fast-check";
 * import { parseResource, serializeResource } from "@cosyte/fhir";
 * import { resource } from "@cosyte/fhir/arbitraries";
 *
 * fc.assert(
 *   fc.property(resource(), (model) => {
 *     const text = serializeResource(model);
 *     return serializeResource(parseResource(text).resource) === text;
 *   }),
 * );
 * ```
 *
 * @packageDocumentation
 */

export { RESOURCE_TYPES, bundle, resource, resourceType } from "./resource.js";
export type { BundleOptions, ResourceOptions, ResourceType } from "./resource.js";
export { hostileInput, resourceJson, resourceXml } from "./text.js";
export type { HostileInputOptions } from "./text.js";
export { decimalText, stringValue } from "./values.js";
export type { DecimalTextOptions, StringValueOptions } from "./values.js";
