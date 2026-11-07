# Trademarks

`@cosyte/fhir` is an independent open-source project. Cosyte is **not affiliated with, endorsed by,
or sponsored by** Health Level Seven International or any other organization named in this
repository or its documentation.

HL7® and FHIR® are the registered trademarks of Health Level Seven International, and their use
here does not constitute endorsement by HL7.

## Why these names appear

`@cosyte/fhir` reads, writes, and validates documents in HL7's FHIR R4 standard, so it has to name
the standard, the implementation guides built on it, and the code systems a FHIR document refers to.
Every reference is **descriptive**: it identifies the specification or code system a feature works
with, and nothing more.

## What the package contains

The readers, writers, and validators are implemented in this repository from the published FHIR R4
specification. The package bundles no terminology content and no profile content: no concept tables
from any code system named below, and no US Core `StructureDefinition`. A code system is known to it
only by its published identity.

## Names referenced

| Name                                                               | Where it appears                                                                                                                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HL7, FHIR                                                          | The standard this package implements: its name, its API, and its documentation.                                                                                                         |
| US Core                                                            | The HL7 implementation guide whose profiles a caller can supply; named in the README and the documentation.                                                                             |
| SMART on FHIR                                                      | Named in the README, as part of the US regulatory context for FHIR R4.                                                                                                                  |
| LOINC, SNOMED CT, RxNorm, ICD-10-CM, ICD-9-CM, CPT, UCUM, NDC, CVX | `KNOWN_SYSTEMS` and the system constants beside it: the code systems the package recognizes by their published identity. The documentation names several as content it does not bundle. |

All product names, logos, and brands are the property of their respective owners. Use of a name here
does not imply any affiliation with, or endorsement by, its owner. If you own one of these marks and
would like a reference changed, please open an issue.
