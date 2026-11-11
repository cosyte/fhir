/**
 * What the FHIR R4 and R4B definitions say is below each element the safety readout reads: for the
 * ten resource types it assesses, every element each of them defines, each backbone element and
 * datatype those elements are typed as, and so on down, closed over every context they reach.
 *
 * {@link ELEMENT_DEFINITIONS} lists, per context (a type such as `Patient` or `Quantity`, or a
 * backbone element such as `Bundle.entry`), the names a document may write there, separated by
 * spaces. A bare name is a primitive. `name:Context` is typed as that context, `name:*` is a position
 * the definitions type as `Resource`, and `name:A|B` is typed as either. A choice element is listed
 * by each name a document writes (`valueQuantity`, `valueString`), never as `value[x]`. A name is
 * listed when R4 or R4B defines it, so a document of either release reads as it is written.
 *
 * The table is checked, entry for entry, against `test/__data__/fhir-element-definitions.json`, a
 * projection of the R4 4.0.1 and R4B 4.3.0 StructureDefinitions that CI re-derives from the
 * definition files pinned by digest (`pnpm definitions:check`). Edit the two together: a change to
 * one alone fails `test/element-definitions.test.ts`.
 *
 * @internal
 */

/** The assessed types and every context below them: the names each defines, as described above. */
export const ELEMENT_DEFINITIONS: Readonly<Record<string, string>> = {
  Address:
    "city country district extension:Extension id line period:Period postalCode state text type use",
  Age: "code comparator extension:Extension id system unit value",
  AllergyIntolerance:
    "asserter:Reference category clinicalStatus:CodeableConcept code:CodeableConcept contained:* criticality encounter:Reference extension:Extension id identifier:Identifier implicitRules language lastOccurrence meta:Meta modifierExtension:Extension note:Annotation onsetAge:Age onsetDateTime onsetPeriod:Period onsetRange:Range onsetString patient:Reference reaction:AllergyIntolerance.reaction recordedDate recorder:Reference text:Narrative type verificationStatus:CodeableConcept",
  "AllergyIntolerance.reaction":
    "description exposureRoute:CodeableConcept extension:Extension id manifestation:CodeableConcept modifierExtension:Extension note:Annotation onset severity substance:CodeableConcept",
  Annotation: "authorReference:Reference authorString extension:Extension id text time",
  Attachment: "contentType creation data extension:Extension hash id language size title url",
  Bundle:
    "entry:Bundle.entry id identifier:Identifier implicitRules language link:Bundle.link meta:Meta signature:Signature timestamp total type",
  "Bundle.entry":
    "extension:Extension fullUrl id link:Bundle.link modifierExtension:Extension request:Bundle.entry.request resource:* response:Bundle.entry.response search:Bundle.entry.search",
  "Bundle.entry.request":
    "extension:Extension id ifMatch ifModifiedSince ifNoneExist ifNoneMatch method modifierExtension:Extension url",
  "Bundle.entry.response":
    "etag extension:Extension id lastModified location modifierExtension:Extension outcome:* status",
  "Bundle.entry.search": "extension:Extension id mode modifierExtension:Extension score",
  "Bundle.link": "extension:Extension id modifierExtension:Extension relation url",
  CodeableConcept: "coding:Coding extension:Extension id text",
  CodeableReference: "concept:CodeableConcept extension:Extension id reference:Reference",
  Coding: "code display extension:Extension id system userSelected version",
  Condition:
    "abatementAge:Age abatementDateTime abatementPeriod:Period abatementRange:Range abatementString asserter:Reference bodySite:CodeableConcept category:CodeableConcept clinicalStatus:CodeableConcept code:CodeableConcept contained:* encounter:Reference evidence:Condition.evidence extension:Extension id identifier:Identifier implicitRules language meta:Meta modifierExtension:Extension note:Annotation onsetAge:Age onsetDateTime onsetPeriod:Period onsetRange:Range onsetString recordedDate recorder:Reference severity:CodeableConcept stage:Condition.stage subject:Reference text:Narrative verificationStatus:CodeableConcept",
  "Condition.evidence":
    "code:CodeableConcept detail:Reference extension:Extension id modifierExtension:Extension",
  "Condition.stage":
    "assessment:Reference extension:Extension id modifierExtension:Extension summary:CodeableConcept type:CodeableConcept",
  ContactDetail: "extension:Extension id name telecom:ContactPoint",
  ContactPoint: "extension:Extension id period:Period rank system use value",
  Contributor: "contact:ContactDetail extension:Extension id name type",
  Count: "code comparator extension:Extension id system unit value",
  DataRequirement:
    "codeFilter:DataRequirement.codeFilter dateFilter:DataRequirement.dateFilter extension:Extension id limit mustSupport profile sort:DataRequirement.sort subjectCodeableConcept:CodeableConcept subjectReference:Reference type",
  "DataRequirement.codeFilter": "code:Coding extension:Extension id path searchParam valueSet",
  "DataRequirement.dateFilter":
    "extension:Extension id path searchParam valueDateTime valueDuration:Duration valuePeriod:Period",
  "DataRequirement.sort": "direction extension:Extension id path",
  DiagnosticReport:
    "basedOn:Reference category:CodeableConcept code:CodeableConcept conclusion conclusionCode:CodeableConcept contained:* effectiveDateTime effectivePeriod:Period encounter:Reference extension:Extension id identifier:Identifier imagingStudy:Reference implicitRules issued language media:DiagnosticReport.media meta:Meta modifierExtension:Extension performer:Reference presentedForm:Attachment result:Reference resultsInterpreter:Reference specimen:Reference status subject:Reference text:Narrative",
  "DiagnosticReport.media":
    "comment extension:Extension id link:Reference modifierExtension:Extension",
  Distance: "code comparator extension:Extension id system unit value",
  Dosage:
    "additionalInstruction:CodeableConcept asNeededBoolean asNeededCodeableConcept:CodeableConcept doseAndRate:Dosage.doseAndRate extension:Extension id maxDosePerAdministration:Quantity maxDosePerLifetime:Quantity maxDosePerPeriod:Ratio method:CodeableConcept modifierExtension:Extension patientInstruction route:CodeableConcept sequence site:CodeableConcept text timing:Timing",
  "Dosage.doseAndRate":
    "doseQuantity:Quantity doseRange:Range extension:Extension id rateQuantity:Quantity rateRange:Range rateRatio:Ratio type:CodeableConcept",
  Duration: "code comparator extension:Extension id system unit value",
  Expression: "description expression extension:Extension id language name reference",
  Extension:
    "extension:Extension id url valueAddress:Address valueAge:Age valueAnnotation:Annotation valueAttachment:Attachment valueBase64Binary valueBoolean valueCanonical valueCode valueCodeableConcept:CodeableConcept valueCodeableReference:CodeableReference valueCoding:Coding valueContactDetail:ContactDetail valueContactPoint:ContactPoint valueContributor:Contributor valueCount:Count valueDataRequirement:DataRequirement valueDate valueDateTime valueDecimal valueDistance:Distance valueDosage:Dosage valueDuration:Duration valueExpression:Expression valueHumanName:HumanName valueId valueIdentifier:Identifier valueInstant valueInteger valueMarkdown valueMeta:Meta valueMoney:Money valueOid valueParameterDefinition:ParameterDefinition valuePeriod:Period valuePositiveInt valueQuantity:Quantity valueRange:Range valueRatio:Ratio valueRatioRange:RatioRange valueReference:Reference valueRelatedArtifact:RelatedArtifact valueSampledData:SampledData valueSignature:Signature valueString valueTime valueTiming:Timing valueTriggerDefinition:TriggerDefinition valueUnsignedInt valueUri valueUrl valueUsageContext:UsageContext valueUuid",
  HumanName: "extension:Extension family given id period:Period prefix suffix text use",
  Identifier:
    "assigner:Reference extension:Extension id period:Period system type:CodeableConcept use value",
  Immunization:
    "contained:* doseQuantity:Quantity education:Immunization.education encounter:Reference expirationDate extension:Extension fundingSource:CodeableConcept id identifier:Identifier implicitRules isSubpotent language location:Reference lotNumber manufacturer:Reference meta:Meta modifierExtension:Extension note:Annotation occurrenceDateTime occurrenceString patient:Reference performer:Immunization.performer primarySource programEligibility:CodeableConcept protocolApplied:Immunization.protocolApplied reaction:Immunization.reaction reasonCode:CodeableConcept reasonReference:Reference recorded reportOrigin:CodeableConcept route:CodeableConcept site:CodeableConcept status statusReason:CodeableConcept subpotentReason:CodeableConcept text:Narrative vaccineCode:CodeableConcept",
  "Immunization.education":
    "documentType extension:Extension id modifierExtension:Extension presentationDate publicationDate reference",
  "Immunization.performer":
    "actor:Reference extension:Extension function:CodeableConcept id modifierExtension:Extension",
  "Immunization.protocolApplied":
    "authority:Reference doseNumberPositiveInt doseNumberString extension:Extension id modifierExtension:Extension series seriesDosesPositiveInt seriesDosesString targetDisease:CodeableConcept",
  "Immunization.reaction":
    "date detail:Reference extension:Extension id modifierExtension:Extension reported",
  MedicationRequest:
    "authoredOn basedOn:Reference category:CodeableConcept contained:* courseOfTherapyType:CodeableConcept detectedIssue:Reference dispenseRequest:MedicationRequest.dispenseRequest doNotPerform dosageInstruction:Dosage encounter:Reference eventHistory:Reference extension:Extension groupIdentifier:Identifier id identifier:Identifier implicitRules instantiatesCanonical instantiatesUri insurance:Reference intent language medicationCodeableConcept:CodeableConcept medicationReference:Reference meta:Meta modifierExtension:Extension note:Annotation performer:Reference performerType:CodeableConcept priorPrescription:Reference priority reasonCode:CodeableConcept reasonReference:Reference recorder:Reference reportedBoolean reportedReference:Reference requester:Reference status statusReason:CodeableConcept subject:Reference substitution:MedicationRequest.substitution supportingInformation:Reference text:Narrative",
  "MedicationRequest.dispenseRequest":
    "dispenseInterval:Duration expectedSupplyDuration:Duration extension:Extension id initialFill:MedicationRequest.dispenseRequest.initialFill modifierExtension:Extension numberOfRepeatsAllowed performer:Reference quantity:Quantity validityPeriod:Period",
  "MedicationRequest.dispenseRequest.initialFill":
    "duration:Duration extension:Extension id modifierExtension:Extension quantity:Quantity",
  "MedicationRequest.substitution":
    "allowedBoolean allowedCodeableConcept:CodeableConcept extension:Extension id modifierExtension:Extension reason:CodeableConcept",
  MedicationStatement:
    "basedOn:Reference category:CodeableConcept contained:* context:Reference dateAsserted derivedFrom:Reference dosage:Dosage effectiveDateTime effectivePeriod:Period extension:Extension id identifier:Identifier implicitRules informationSource:Reference language medicationCodeableConcept:CodeableConcept medicationReference:Reference meta:Meta modifierExtension:Extension note:Annotation partOf:Reference reasonCode:CodeableConcept reasonReference:Reference status statusReason:CodeableConcept subject:Reference text:Narrative",
  Meta: "extension:Extension id lastUpdated profile security:Coding source tag:Coding versionId",
  Money: "currency extension:Extension id value",
  Narrative: "div extension:Extension id status",
  Observation:
    "basedOn:Reference bodySite:CodeableConcept category:CodeableConcept code:CodeableConcept component:Observation.component contained:* dataAbsentReason:CodeableConcept derivedFrom:Reference device:Reference effectiveDateTime effectiveInstant effectivePeriod:Period effectiveTiming:Timing encounter:Reference extension:Extension focus:Reference hasMember:Reference id identifier:Identifier implicitRules interpretation:CodeableConcept issued language meta:Meta method:CodeableConcept modifierExtension:Extension note:Annotation partOf:Reference performer:Reference referenceRange:Observation.referenceRange specimen:Reference status subject:Reference text:Narrative valueBoolean valueCodeableConcept:CodeableConcept valueDateTime valueInteger valuePeriod:Period valueQuantity:Quantity valueRange:Range valueRatio:Ratio valueSampledData:SampledData valueString valueTime",
  "Observation.component":
    "code:CodeableConcept dataAbsentReason:CodeableConcept extension:Extension id interpretation:CodeableConcept modifierExtension:Extension referenceRange:Observation.referenceRange valueBoolean valueCodeableConcept:CodeableConcept valueDateTime valueInteger valuePeriod:Period valueQuantity:Quantity valueRange:Range valueRatio:Ratio valueSampledData:SampledData valueString valueTime",
  "Observation.referenceRange":
    "age:Range appliesTo:CodeableConcept extension:Extension high:Quantity id low:Quantity modifierExtension:Extension text type:CodeableConcept",
  ParameterDefinition: "documentation extension:Extension id max min name profile type use",
  Patient:
    "active address:Address birthDate communication:Patient.communication contact:Patient.contact contained:* deceasedBoolean deceasedDateTime extension:Extension gender generalPractitioner:Reference id identifier:Identifier implicitRules language link:Patient.link managingOrganization:Reference maritalStatus:CodeableConcept meta:Meta modifierExtension:Extension multipleBirthBoolean multipleBirthInteger name:HumanName photo:Attachment telecom:ContactPoint text:Narrative",
  "Patient.communication":
    "extension:Extension id language:CodeableConcept modifierExtension:Extension preferred",
  "Patient.contact":
    "address:Address extension:Extension gender id modifierExtension:Extension name:HumanName organization:Reference period:Period relationship:CodeableConcept telecom:ContactPoint",
  "Patient.link": "extension:Extension id modifierExtension:Extension other:Reference type",
  Period: "end extension:Extension id start",
  Practitioner:
    "active address:Address birthDate communication:CodeableConcept contained:* extension:Extension gender id identifier:Identifier implicitRules language meta:Meta modifierExtension:Extension name:HumanName photo:Attachment qualification:Practitioner.qualification telecom:ContactPoint text:Narrative",
  "Practitioner.qualification":
    "code:CodeableConcept extension:Extension id identifier:Identifier issuer:Reference modifierExtension:Extension period:Period",
  Quantity: "code comparator extension:Extension id system unit value",
  Range: "extension:Extension high:Quantity id low:Quantity",
  Ratio: "denominator:Quantity extension:Extension id numerator:Quantity",
  RatioRange:
    "denominator:Quantity extension:Extension highNumerator:Quantity id lowNumerator:Quantity",
  Reference: "display extension:Extension id identifier:Identifier reference type",
  RelatedArtifact:
    "citation display document:Attachment extension:Extension id label resource type url",
  SampledData:
    "data dimensions extension:Extension factor id lowerLimit origin:Quantity period upperLimit",
  Signature:
    "data extension:Extension id onBehalfOf:Reference sigFormat targetFormat type:Coding when who:Reference",
  Timing:
    "code:CodeableConcept event extension:Extension id modifierExtension:Extension repeat:Timing.repeat",
  "Timing.repeat":
    "boundsDuration:Duration boundsPeriod:Period boundsRange:Range count countMax dayOfWeek duration durationMax durationUnit extension:Extension frequency frequencyMax id offset period periodMax periodUnit timeOfDay when",
  TriggerDefinition:
    "condition:Expression data:DataRequirement extension:Extension id name timingDate timingDateTime timingReference:Reference timingTiming:Timing type",
  UsageContext:
    "code:Coding extension:Extension id valueCodeableConcept:CodeableConcept valueQuantity:Quantity valueRange:Range valueReference:Reference",
};

/** The target a {@link ELEMENT_DEFINITIONS} entry gives a position the definitions type as `Resource`. */
export const RESOURCE_TARGET = "*";

/** The target of a primitive element: it has no context of its own. */
export const PRIMITIVE_TARGET = "";

/** The table, read into maps the first time a walk asks, then kept. */
let parsed: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>> | undefined;

function definitions(): ReadonlyMap<string, ReadonlyMap<string, readonly string[]>> {
  if (parsed !== undefined) return parsed;
  const contexts = new Map<string, ReadonlyMap<string, readonly string[]>>();
  for (const [context, names] of Object.entries(ELEMENT_DEFINITIONS)) {
    const members = new Map<string, readonly string[]>();
    for (const token of names.split(" ")) {
      const colon = token.indexOf(":");
      if (colon < 0) members.set(token, [PRIMITIVE_TARGET]);
      else members.set(token.slice(0, colon), token.slice(colon + 1).split("|"));
    }
    contexts.set(context, members);
  }
  parsed = contexts;
  return parsed;
}

/**
 * What the definitions put below the element `name` in any of `contexts`: the contexts it is typed
 * as, {@link RESOURCE_TARGET}, or {@link PRIMITIVE_TARGET}. `undefined` when none of them defines
 * the name, which is how an element the format does not define is told apart.
 *
 * @param contexts - The contexts the node holding the element is read against.
 * @param name - The element name, exactly as the document wrote it.
 * @returns The targets, or `undefined` for a name no context defines.
 * @example
 * ```ts
 * elementTargets(["Bundle"], "entry"); // ["Bundle.entry"]
 * elementTargets(["Bundle.entry"], "resource"); // ["*"]
 * elementTargets(["Patient"], "entry"); // undefined
 * ```
 */
export function elementTargets(
  contexts: readonly string[],
  name: string,
): readonly string[] | undefined {
  const table = definitions();
  let found: string[] | undefined;
  for (const context of contexts) {
    const targets = table.get(context)?.get(name);
    if (targets === undefined) continue;
    if (contexts.length === 1) return targets;
    found ??= [];
    for (const target of targets) if (!found.includes(target)) found.push(target);
  }
  return found;
}
