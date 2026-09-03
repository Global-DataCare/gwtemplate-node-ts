// src/api-examples/composition.examples.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';

import { Format } from 'gdc-common-utils-ts/constants/Schemas';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { CompositionClaim } from 'gdc-common-utils-ts/models/interoperable-claims/composition-claims';
import { MedicationStatementClaim } from 'gdc-common-utils-ts/models/interoperable-claims/medication-statement-claims';
import {
  EXAMPLE_CLINICAL_SECTION_HISTORY_MEDICATION,
  EXAMPLE_CLINICAL_SECTION_PATIENT_SUMMARY,
  EXAMPLE_COMPOSITION_DATE_MEDICATION_DOCUMENT,
  EXAMPLE_DOCUMENT_REFERENCE_IDENTIFIER,
  EXAMPLE_DOCUMENT_REFERENCE_IDENTIFIER_SECONDARY,
  EXAMPLE_API_ORGANIZATION_DID,
  EXAMPLE_JOB_IDENTIFIER_LICENSE_SEARCH,
  EXAMPLE_MEDICATION_CODE_RXNORM,
  EXAMPLE_PROFESSIONAL_DID,
  EXAMPLE_RESEARCH_CONTROLLER_DID,
  EXAMPLE_SUBJECT_DID,
  EXAMPLE_THREAD_IDENTIFIER_LICENSE_SEARCH,
} from 'gdc-common-utils-ts/examples/shared';

export const COMPOSITION_BATCH_ENTRY_EXAMPLE = {
  type: ResourceTypesFhirR4.Composition,
  resource: {
    resourceType: ResourceTypesFhirR4.Composition,
    meta: { claims: {
      '@context': Format.FHIR_API,
      [CompositionClaim.Subject]: EXAMPLE_SUBJECT_DID,
      [CompositionClaim.Section]: EXAMPLE_CLINICAL_SECTION_HISTORY_MEDICATION,
      [CompositionClaim.Author]: EXAMPLE_PROFESSIONAL_DID,
      [CompositionClaim.Date]: EXAMPLE_COMPOSITION_DATE_MEDICATION_DOCUMENT,
      [CompositionClaim.Entry]: `${EXAMPLE_DOCUMENT_REFERENCE_IDENTIFIER},${EXAMPLE_DOCUMENT_REFERENCE_IDENTIFIER_SECONDARY}`,
      [CompositionClaim.Type]: EXAMPLE_CLINICAL_SECTION_PATIENT_SUMMARY,
    } },
  },
} as const;

export const COMPOSITION_SEARCH_BUNDLE_EXAMPLE = {
  resourceType: ResourceTypesFhirR4.Bundle,
  type: 'batch',
  entry: [
    {
      request: {
        method: HttpRequestMethods.Get,
        url: `${ResourceTypesFhirR4.Composition}?subject=${EXAMPLE_SUBJECT_DID}`,
      },
    },
  ],
} as const;

export const COMPOSITION_SEARCH_PARAMETERS_EXAMPLE = {
  resourceType: ResourceTypesFhirR4.Parameters,
  parameter: [
    {
      name: 'subject',
      valueString: EXAMPLE_SUBJECT_DID,
    },
  ],
} as const;

export const DIGITAL_TWIN_COMPOSITION_SEARCH_MESSAGE_EXAMPLE = {
  jti: EXAMPLE_JOB_IDENTIFIER_LICENSE_SEARCH,
  thid: EXAMPLE_THREAD_IDENTIFIER_LICENSE_SEARCH,
  iss: EXAMPLE_RESEARCH_CONTROLLER_DID,
  aud: EXAMPLE_API_ORGANIZATION_DID,
  type: 'application/fhir+json; fhirVersion=4.0',
  body: {
    resourceType: ResourceTypesFhirR4.Parameters,
    parameter: [
      {
        name: CompositionClaim.Section.split('.')[1],
        valueString: EXAMPLE_CLINICAL_SECTION_HISTORY_MEDICATION,
      },
      {
        name: MedicationStatementClaim.Code,
        valueString: EXAMPLE_MEDICATION_CODE_RXNORM,
      },
    ],
  },
} as const;
