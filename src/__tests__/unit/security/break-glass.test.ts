import { BreakGlassService, evaluateBreakGlassPolicy } from '../../../security/break-glass';

const humanRequest = {
  routeSector: 'health-care',
  subjectKind: 'human' as const,
  professionalRole: 'ISCO-08|2211',
  requestedScope: 'organization/Composition.rs?subject=did:web:gw.example:individual:123&section=allergies,medications',
  reasonCode: 'life-threatening' as const,
};

describe('break-glass sector and profession policy', () => {
  it('allows a verified physician to request read-only human emergency access through health-care', () => {
    expect(evaluateBreakGlassPolicy(humanRequest)).toEqual({ allowed: true, maxLifetimeSeconds: 900 });
  });

  it.each(['health-research', 'onehealth-research', 'animal-care', 'animal-research'])(
    'never allows a human break-glass request through %s',
    (routeSector) => expect(evaluateBreakGlassPolicy({ ...humanRequest, routeSector })).toMatchObject({ allowed: false }),
  );

  it('does not infer emergency authority from nursing or employment alone', () => {
    expect(evaluateBreakGlassPolicy({ ...humanRequest, professionalRole: 'ISCO-08|2221' })).toMatchObject({
      allowed: false,
      reason: 'professional_role_not_authorized',
    });
  });

  it('allows veterinarians only for animal subjects through animal-care', () => {
    const animal = {
      ...humanRequest,
      routeSector: 'animal-care',
      subjectKind: 'animal' as const,
      professionalRole: 'ISCO-08|2250',
      reasonCode: 'animal-emergency' as const,
    };
    expect(evaluateBreakGlassPolicy(animal)).toMatchObject({ allowed: true });
    expect(evaluateBreakGlassPolicy({ ...animal, routeSector: 'health-care' })).toMatchObject({ allowed: false });
  });

  it('rejects write scopes even for an otherwise authorized physician', () => {
    expect(evaluateBreakGlassPolicy({
      ...humanRequest,
      requestedScope: 'organization/Composition.cruds?subject=did:web:gw.example:individual:123&section=*',
    })).toMatchObject({ allowed: false, reason: 'read_only_scope_required' });
  });
});

describe('break-glass audit and controller notice', () => {
  it('writes coded hash-only ledger events and requires notification acknowledgement', async () => {
    const registerArtifactBundle = jest.fn().mockResolvedValue({ accepted: 1, txId: 'tx' });
    const notify = jest.fn().mockResolvedValue({ notificationId: 'notice-123' });
    const service = new BreakGlassService(
      { discoverDidsByHashes: jest.fn(), registerArtifactBundle },
      { notify },
      () => new Date('2026-08-26T12:00:00.000Z'),
    );
    const result = await service.authorize({
      tenantId: 'municipal-service',
      jurisdiction: 'ES',
      routeSector: 'health-care',
      actorDid: 'did:web:provider.example:employee:doctor:ISCO-08|2211',
      professionalRole: 'ISCO-08|2211',
      subjectDid: 'did:web:gw.example:individual:123',
      requestedScope: humanRequest.requestedScope,
      request: {
        incidentId: 'incident-123',
        subjectKind: 'human',
        reasonCode: 'life-threatening',
        justification: 'Immediate access is needed to avoid serious harm.',
      },
      professionalCredentialVerified: true,
      ledgerVerified: true,
      requestedLifetimeSeconds: 1200,
    });

    expect(result.lifetimeSeconds).toBe(900);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(registerArtifactBundle).toHaveBeenCalledTimes(2);
    const firstPayload = registerArtifactBundle.mock.calls[0][0].payload;
    expect(firstPayload).toMatchObject({
      type: 'BreakGlassAuthorization',
      routeSector: 'health-care',
      subjectKind: 'human',
      reasonCode: 'life-threatening',
      controllerNotification: 'pending',
    });
    expect(JSON.stringify(firstPayload)).not.toContain('Immediate access');
    expect(JSON.stringify(firstPayload)).not.toContain('did:web:gw.example:individual:123');
  });

  it('rejects a declared animal kind for a human DID before writing audit data', async () => {
    const registerArtifactBundle = jest.fn();
    const service = new BreakGlassService(
      { discoverDidsByHashes: jest.fn(), registerArtifactBundle },
      { notify: jest.fn() },
    );
    await expect(service.authorize({
      tenantId: 'vet', jurisdiction: 'ES', routeSector: 'animal-care',
      actorDid: 'did:web:provider.example:employee:vet:ISCO-08|2250', professionalRole: 'ISCO-08|2250',
      subjectDid: 'did:web:gw.example:individual:123',
      requestedScope: 'organization/Composition.rs?subject=did:web:gw.example:individual:123',
      request: { incidentId: 'incident-123', subjectKind: 'animal', reasonCode: 'animal-emergency', justification: 'Immediate veterinary emergency access.' },
      professionalCredentialVerified: true, ledgerVerified: true, requestedLifetimeSeconds: 300,
    })).rejects.toThrow('subject_kind_mismatch');
    expect(registerArtifactBundle).not.toHaveBeenCalled();
  });
});
