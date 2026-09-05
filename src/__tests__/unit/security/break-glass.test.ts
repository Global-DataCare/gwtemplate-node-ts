// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
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
  it('persists one 24-hour emergency Consent and issues renewable 15-minute token authorizations', async () => {
    const previousDataChannel = process.env.LEDGER_DATA_CHANNEL_DEFAULT;
    process.env.LEDGER_DATA_CHANNEL_DEFAULT = 'must-not-control-manager-routing';
    const registerArtifactBundle = jest.fn().mockResolvedValue({ accepted: 1, txId: 'tx' });
    const notify = jest.fn().mockResolvedValue({ notificationId: 'notice-123' });
    const records = new Map<string, any>();
    const vaultRepository = {
      get: jest.fn(async (_vault: string, id: string) => records.get(id)),
      put: jest.fn(async (_vault: string, values: any[]) => {
        for (const value of values) records.set(value.id, value);
        return true;
      }),
    } as any;
    let now = new Date('2026-08-26T12:00:00.000Z');
    const service = new BreakGlassService(
      { discoverDidsByHashes: jest.fn(), registerArtifactBundle },
      vaultRepository,
      { notify },
      () => now,
      { consentLifetimeSeconds: 86_400 },
    );
    const input = {
      tenantId: 'municipal-service',
      jurisdiction: 'ES',
      routeSector: 'health-care',
      actorDid: 'did:web:provider.example:employee:doctor:ISCO-08|2211',
      actorOrganizationDid: 'did:web:provider.example:organization:taxid:clinic-a',
      requestingClientId: 'did:key:clinic-a-workstation-1',
      tokenAudience: 'did:web:gw.example',
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
    } as const;
    const result = await service.authorize(input);

    expect(result.lifetimeSeconds).toBe(900);
    expect(result.consentExpiresAt).toBe('2026-08-27T12:00:00.000Z');
    expect(result.expiresAt).toBe('2026-08-26T12:15:00.000Z');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      requesterOrganizationDid: input.actorOrganizationDid,
      jurisdiction: 'ES',
      professionalActorHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      consentLedgerAssetId: `break-glass-consent:${result.emergencyConsentId}`,
      communication: expect.objectContaining({
        resourceType: ResourceTypesFhirR4.Communication,
        subject: { reference: input.subjectDid },
        sender: { reference: input.actorOrganizationDid },
      }),
    }));
    expect(JSON.stringify(notify.mock.calls[0][0])).not.toContain(input.actorDid);
    expect(notify.mock.calls[0][0]).not.toHaveProperty('justification');
    expect(JSON.stringify(notify.mock.calls[0][0])).not.toContain('doctor');
    expect(vaultRepository.put).toHaveBeenCalledTimes(1);
    const storedConsent = [...records.values()][0];
    expect(storedConsent).toMatchObject({
      'Consent.status': 'active',
      'Consent.decision': 'permit',
      'Consent.subject': input.subjectDid,
      'Consent.actor-identifier': input.actorDid,
      'Consent.actor-role': input.professionalRole,
      'Consent.purpose': 'ETREAT',
      'Consent.period-start': '2026-08-26T12:00:00.000Z',
      'Consent.period-end': '2026-08-27T12:00:00.000Z',
    });
    expect(registerArtifactBundle).toHaveBeenCalledTimes(3);
    expect(registerArtifactBundle.mock.calls.every(([params]) => !('chaincode' in params))).toBe(true);
    expect(registerArtifactBundle.mock.calls.every(([params]) => params.channel === 'health-care-eu')).toBe(true);
    const firstPayload = registerArtifactBundle.mock.calls[0][0].payload;
    expect(firstPayload).toMatchObject({
      type: 'BreakGlassEmergencyConsent',
      consentClaimsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      routeSector: 'health-care',
      subjectKind: 'human',
      reasonCode: 'life-threatening',
      controllerNotification: 'pending',
    });
    expect(JSON.stringify(firstPayload)).not.toContain('Immediate access');
    expect(JSON.stringify(firstPayload)).not.toContain('did:web:gw.example:individual:123');

    now = new Date('2026-08-26T13:00:00.000Z');
    const renewed = await service.authorize({ ...input, requestedLifetimeSeconds: 900 });
    expect(renewed.emergencyConsentId).toBe(result.emergencyConsentId);
    expect(renewed.authorizationId).not.toBe(result.authorizationId);
    expect(renewed.consentExpiresAt).toBe(result.consentExpiresAt);
    expect(renewed.expiresAt).toBe('2026-08-26T13:15:00.000Z');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vaultRepository.put).toHaveBeenCalledTimes(1);
    expect(registerArtifactBundle).toHaveBeenCalledTimes(4);
    expect(registerArtifactBundle.mock.calls[3][0].payload).toMatchObject({
      type: 'BreakGlassTokenAuthorization',
      emergencyConsentId: result.emergencyConsentId,
      requestingClientIdHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      tokenAudienceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    if (previousDataChannel === undefined) delete process.env.LEDGER_DATA_CHANNEL_DEFAULT;
    else process.env.LEDGER_DATA_CHANNEL_DEFAULT = previousDataChannel;
  });

  it('rejects a declared animal kind for a human DID before writing audit data', async () => {
    const registerArtifactBundle = jest.fn();
    const service = new BreakGlassService(
      { discoverDidsByHashes: jest.fn(), registerArtifactBundle },
      { get: jest.fn(), put: jest.fn() } as any,
      { notify: jest.fn() },
    );
    await expect(service.authorize({
      tenantId: 'vet', jurisdiction: 'ES', routeSector: 'animal-care',
      actorDid: 'did:web:provider.example:employee:vet:ISCO-08|2250', professionalRole: 'ISCO-08|2250',
      actorOrganizationDid: 'did:web:provider.example:organization:taxid:clinic-a',
      requestingClientId: 'did:key:clinic-a-workstation-1', tokenAudience: 'did:web:gw.example',
      subjectDid: 'did:web:gw.example:individual:123',
      requestedScope: 'organization/Composition.rs?subject=did:web:gw.example:individual:123',
      request: { incidentId: 'incident-123', subjectKind: 'animal', reasonCode: 'animal-emergency', justification: 'Immediate veterinary emergency access.' },
      professionalCredentialVerified: true, ledgerVerified: true, requestedLifetimeSeconds: 300,
    })).rejects.toThrow('subject_kind_mismatch');
    expect(registerArtifactBundle).not.toHaveBeenCalled();
  });
});
