import { describe, expect, it } from '@jest/globals';
import { COMMUNICATION_INGESTION_ENTRY_EXAMPLE } from '../../../api-examples';

describe('api-examples communication', () => {
  it('uses payload+note (no contained) for FHIR Communication ingestion example', () => {
    const resource: any = COMMUNICATION_INGESTION_ENTRY_EXAMPLE.resource;
    expect(resource.resourceType).toBe('Communication');
    expect(resource.contained).toBeUndefined();
    expect(Array.isArray(resource.payload)).toBe(true);
    expect(resource.payload).toHaveLength(1);
    expect(Array.isArray(resource.note)).toBe(true);
    expect(resource.note).toHaveLength(1);
  });

  it('keeps claims aligned with payload-based Communication shape', () => {
    const claims: any = COMMUNICATION_INGESTION_ENTRY_EXAMPLE.resource.meta.claims;
    expect(claims['Communication.content-attachment-type']).toBe('application/fhir+json');
    expect(claims['Communication.note']).toBe('IPS ingestion request');
  });
});

