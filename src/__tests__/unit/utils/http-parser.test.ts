// TDD contract: write this test red first; make it green only with the complete real behavior.
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { describe, expect, it } from '@jest/globals';
import { extractHttpRequestDataAsJson } from '../../../utils/http-parser';

describe('http-parser', () => {
  it('infers application/vnd.api+json when DIDComm payload uses body.data and type is missing', () => {
    const request = extractHttpRequestDataAsJson(
      'http://localhost:3000/acme/cds-ES/v1/health-care/individual/org.schema/Organization/_batch',
      {
        jti: 'jti-001',
        thid: 'thid-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        body: {
          data: [
            {
              type: ResourceTypesFhirR4.Organization,
              meta: { claims: { '@context': 'org.schema' } },
            },
          ],
        },
      },
      'application/json',
      'POST',
    );

    expect(request.content?.type).toBe('application/vnd.api+json');
  });

  it('infers application/fhir+json with fhirVersion when DIDComm payload uses body.entry and type is missing', () => {
    const request = extractHttpRequestDataAsJson(
      'http://localhost:3000/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Observation/_batch',
      {
        jti: 'jti-002',
        thid: 'thid-002',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        body: {
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          entry: [
            {
              resource: { resourceType: ResourceTypesFhirR4.Observation },
              meta: { claims: { '@context': 'org.hl7.fhir.r4' } },
            },
          ],
        },
      },
      'application/json',
      'POST',
    );

    expect(request.content?.type).toBe('application/fhir+json; fhirVersion=4.0');
  });

  it('preserves explicit payload type when already provided', () => {
    const request = extractHttpRequestDataAsJson(
      'http://localhost:3000/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Observation/_batch',
      {
        jti: 'jti-003',
        thid: 'thid-003',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        type: 'application/custom+json',
        body: {
          resourceType: ResourceTypesFhirR4.Bundle,
          entry: [],
        },
      },
      'application/json',
      'POST',
    );

    expect(request.content?.type).toBe('application/custom+json');
  });
});
