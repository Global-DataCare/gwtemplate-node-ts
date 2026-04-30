import { describe, expect, it, jest } from '@jest/globals';
import {
  applyFhirCidVersioningToEntry,
  canonicalizeFhirResource,
  fhirResourceToCid,
  registerFhirCidMappings,
} from '../../../utils/fhir-versioning';

describe('fhir-versioning utils', () => {
  it('builds deterministic CID while ignoring pre-existing meta.versionId', () => {
    const a = {
      resourceType: 'Patient',
      id: '68a78f38-7d7d-4f6e-b6ef-0d0066f8c241',
      meta: { versionId: 'old' },
      name: [{ family: 'Lopez', given: ['Ana'] }],
    };
    const b = {
      name: [{ given: ['Ana'], family: 'Lopez' }],
      resourceType: 'Patient',
      id: '68a78f38-7d7d-4f6e-b6ef-0d0066f8c241',
      meta: { versionId: 'new' },
    };

    const cidA = fhirResourceToCid(a);
    const cidB = fhirResourceToCid(b);
    expect(cidA.cid).toBe(cidB.cid);
    expect(cidA.cid.startsWith('z')).toBe(true);
  });

  it('assigns meta.versionId in resource and claims', () => {
    const entry: any = {
      fullUrl: 'urn:uuid:8e4db04c-3536-4b03-a33a-69bb1f3729e7',
      resource: {
        resourceType: 'DocumentReference',
      },
    };
    const claims: Record<string, any> = {
      '@context': 'org.hl7.fhir.r4',
    };

    const out = applyFhirCidVersioningToEntry({
      entry,
      claims,
      resourceType: 'DocumentReference',
      resourceId: '8e4db04c-3536-4b03-a33a-69bb1f3729e7',
    });

    expect(entry.resource.id).toBe('8e4db04c-3536-4b03-a33a-69bb1f3729e7');
    expect(entry.resource.meta.versionId).toBeDefined();
    expect(claims['DocumentReference.meta.versionId']).toBe(entry.resource.meta.versionId);
    expect(claims['org.hl7.fhir.r4.DocumentReference.meta.versionId']).toBe(entry.resource.meta.versionId);
    expect(out.mapping?.fullUrl).toBe(entry.fullUrl);
  });

  it('registers mappings only when adapter supports it', async () => {
    const register = jest.fn(async () => ({ accepted: 1, txId: 'tx-1' }));
    await registerFhirCidMappings({
      blockchainAdapter: { registerCidVersionMappings: register },
      sector: 'health-care',
      jurisdiction: 'ES',
      mappings: [{ cid: 'zabc', versionId: 'zabc' }],
    });

    expect(register).toHaveBeenCalledTimes(1);
    const firstCall = (register.mock.calls as any[])[0];
    expect(firstCall[1]).toBe('health-care-es');
    expect(firstCall[2]).toBe('fhir-versioning');
  });

  it('canonicalizes recursively', () => {
    const canonical = canonicalizeFhirResource({
      b: { z: 1, a: 2 },
      a: [{ d: 1, c: 2 }],
    });
    expect(canonical).toBe('{"a":[{"c":2,"d":1}],"b":{"a":2,"z":1}}');
  });
});
