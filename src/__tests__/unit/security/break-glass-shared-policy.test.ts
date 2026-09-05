// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import {
  BreakGlassReasonCodes,
  BreakGlassSubjectKinds,
  DataspaceSectors,
  EXAMPLE_BREAK_GLASS_INCIDENT_ID,
  EXAMPLE_BREAK_GLASS_ISSUED_AT,
  EXAMPLE_BREAK_GLASS_JUSTIFICATION,
  EXAMPLE_BREAK_GLASS_NOTIFICATION_ID,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PROVIDER_ORGANIZATION_URN,
  EXAMPLE_JURISDICTION,
  EXAMPLE_PROFILE_PROVIDER_DID,
  EXAMPLE_TENANT_IDENTIFIER,
  HealthcareActorRoles,
  buildSmartCompositionReadScope,
  type BreakGlassSubjectKindMatcher,
} from 'gdc-common-utils-ts';
import { BreakGlassService } from '../../../security/break-glass';

describe('BreakGlassService shared policy boundary', () => {
  it('uses an injected domain matcher without teaching GW CORE a card identifier format', async () => {
    const previousDataChannel = process.env.LEDGER_DATA_CHANNEL_DEFAULT;
    process.env.LEDGER_DATA_CHANNEL_DEFAULT = 'must-not-control-manager-routing';
    try {
      const subjectDid = EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PROVIDER_ORGANIZATION_URN;
      const domainMatcher: BreakGlassSubjectKindMatcher = (candidate, kind) =>
        kind === BreakGlassSubjectKinds.Animal && candidate === subjectDid;
      const registerArtifactBundle = jest.fn().mockResolvedValue({ accepted: 1 });
      const service = new BreakGlassService(
        { discoverDidsByHashes: jest.fn(), registerArtifactBundle },
        {
          get: jest.fn().mockResolvedValue(undefined),
          put: jest.fn().mockResolvedValue(true),
        } as any,
        { notify: jest.fn().mockResolvedValue({ notificationId: EXAMPLE_BREAK_GLASS_NOTIFICATION_ID }) },
        () => new Date(EXAMPLE_BREAK_GLASS_ISSUED_AT),
        { subjectKindMatchers: [domainMatcher] },
      );

      const authorization = await service.authorize({
        tenantId: EXAMPLE_TENANT_IDENTIFIER,
        jurisdiction: EXAMPLE_JURISDICTION,
        routeSector: DataspaceSectors.AnimalCare,
        actorDid: EXAMPLE_PROFILE_PROVIDER_DID,
        actorOrganizationDid: EXAMPLE_PROFILE_PROVIDER_DID,
        requestingClientId: EXAMPLE_PROFILE_PROVIDER_DID,
        tokenAudience: EXAMPLE_PROFILE_PROVIDER_DID,
        professionalRole: HealthcareActorRoles.Veterinarian,
        subjectDid,
        requestedScope: buildSmartCompositionReadScope({ subjectDid }),
        request: {
          incidentId: EXAMPLE_BREAK_GLASS_INCIDENT_ID,
          subjectKind: BreakGlassSubjectKinds.Animal,
          reasonCode: BreakGlassReasonCodes.AnimalEmergency,
          justification: EXAMPLE_BREAK_GLASS_JUSTIFICATION,
        },
        professionalCredentialVerified: true,
        ledgerVerified: true,
        requestedLifetimeSeconds: 900,
      });

      expect(authorization.lifetimeSeconds).toBe(900);
      expect(registerArtifactBundle).toHaveBeenCalled();
    } finally {
      if (previousDataChannel === undefined) delete process.env.LEDGER_DATA_CHANNEL_DEFAULT;
      else process.env.LEDGER_DATA_CHANNEL_DEFAULT = previousDataChannel;
    }
  });
});
