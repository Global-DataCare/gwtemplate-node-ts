import { describe, expect, it } from '@jest/globals';
import {
  COMMUNICATION_CHANNEL_RECORD_EXAMPLE,
  COMMUNICATION_FHIR_INLINE_INGESTION_ENTRY_EXAMPLE,
  COMMUNICATION_FHIR_REFERENCE_READ_ENTRY_EXAMPLE,
  COMMUNICATION_INGESTION_ENTRY_EXAMPLE,
} from '../../../api-examples';

describe('api-examples communication', () => {
  it('uses payload+note for FHIR Communication inline-ingestion example', () => {
    const resource: any = COMMUNICATION_FHIR_INLINE_INGESTION_ENTRY_EXAMPLE.resource;
    expect(resource.resourceType).toBe('Communication');
    expect(resource.contained).toBeUndefined();
    expect(Array.isArray(resource.payload)).toBe(true);
    expect(resource.payload).toHaveLength(1);
    expect(resource.payload[0].contentAttachment?.contentType).toBe('application/fhir+json');
    expect(Array.isArray(resource.note)).toBe(true);
    expect(resource.note).toHaveLength(1);
  });

  it('keeps claims aligned for inline-ingestion example', () => {
    const claims: any = COMMUNICATION_FHIR_INLINE_INGESTION_ENTRY_EXAMPLE.resource.meta.claims;
    expect(claims['Communication.content-attachment-type']).toBe('application/fhir+json');
    expect(claims['Communication.note']).toBe('IPS ingestion request');
  });

  it('uses contentReference when the document is already atomized', () => {
    const resource: any = COMMUNICATION_FHIR_REFERENCE_READ_ENTRY_EXAMPLE.resource;
    expect(resource.payload).toHaveLength(1);
    expect(resource.payload[0].contentReference?.reference).toBe('DocumentReference/documentreference-from-communication-zb2rhkExampleCid001');
    expect(resource.payload[0].contentAttachment).toBeUndefined();
    expect(resource.meta.claims['Communication.content-reference']).toBe('DocumentReference/documentreference-from-communication-zb2rhkExampleCid001');
  });

  it('models the persisted channel record as CommMsgExtended with a DocumentReference link', () => {
    const record: any = COMMUNICATION_CHANNEL_RECORD_EXAMPLE;
    const reference = record.body.data.find((entry: any) => entry.type === 'Reference');
    expect(record.type).toBe('CommMsgExtended');
    expect(reference?.resource?.type).toBe('DocumentReference');
    expect(reference?.resource?.reference).toBe('DocumentReference/documentreference-from-communication-zb2rhkExampleCid001');
    expect(record['Communication.content-reference']).toBe('DocumentReference/documentreference-from-communication-zb2rhkExampleCid001');
  });

  it('keeps the legacy alias pointing to the inline-ingestion example', () => {
    expect(COMMUNICATION_INGESTION_ENTRY_EXAMPLE).toBe(COMMUNICATION_FHIR_INLINE_INGESTION_ENTRY_EXAMPLE);
  });
});
