import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { createHash, randomUUID } from 'node:crypto';
import { HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/healthcare';
import { ClaimConsent, ConsentDecisions } from 'gdc-common-utils-ts/models/consent-rule';
import type { RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import type { IBlockchainAdapter } from '../adapters/IBlockchainAdapter';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { getIndividualSectionId } from '../utils/individual-sections';
import { getTenantVaultId } from '../utils/tenant';
import { canonicalize } from '../utils/json-canon';
import { resolveClinicalDataChannel } from '../utils/ledger';
import {
  evaluateBreakGlassPolicy,
  matchesBreakGlassSubjectKind,
  type BreakGlassReasonCode,
  type BreakGlassRequest,
  type BreakGlassSubjectKindMatcher,
} from 'gdc-common-utils-ts/utils/break-glass-policy';

export {
  evaluateBreakGlassPolicy,
} from 'gdc-common-utils-ts/utils/break-glass-policy';
export type {
  BreakGlassPolicyDecision,
  BreakGlassPolicyInput,
  BreakGlassReasonCode,
  BreakGlassRequest,
  BreakGlassSubjectKind,
  BreakGlassSubjectKindMatcher,
} from 'gdc-common-utils-ts/utils/break-glass-policy';

export type BreakGlassAuthorizationInput = Readonly<{
  tenantId: string;
  jurisdiction: string;
  routeSector: string;
  actorDid: string;
  actorOrganizationDid: string;
  requestingClientId: string;
  tokenAudience: string;
  professionalRole: string;
  subjectDid: string;
  requestedScope: string;
  request: BreakGlassRequest;
  professionalCredentialVerified: boolean;
  ledgerVerified: boolean;
  requestedLifetimeSeconds: number;
}>;

export type BreakGlassAuthorization = Readonly<{
  emergencyConsentId: string;
  consentExpiresAt: string;
  authorizationId: string;
  issuedAt: string;
  expiresAt: string;
  lifetimeSeconds: number;
  auditAssetId: string;
  notificationId?: string;
}>;

type EmergencyConsentRecord = RecordBase & Record<string, unknown> & {
  notificationIdHash: string;
};

export type BreakGlassServiceOptions = Readonly<{
  consentLifetimeSeconds?: number;
  subjectKindMatchers?: readonly BreakGlassSubjectKindMatcher[];
}>;

export interface BreakGlassAuthorizer {
  authorize(input: BreakGlassAuthorizationInput): Promise<BreakGlassAuthorization>;
}

export interface BreakGlassControllerNotifier {
  notify(input: Readonly<{
    authorizationId: string;
    incidentId: string;
    requesterOrganizationDid: string;
    jurisdiction: string;
    professionalActorHash: string;
    professionalRole: string;
    subjectDid: string;
    routeSector: string;
    reasonCode: BreakGlassReasonCode;
    issuedAt: string;
    expiresAt: string;
    consentLedgerAssetId: string;
    communication: Readonly<{
      resourceType: typeof ResourceTypesFhirR4.Communication;
      status: 'in-progress';
      identifier: ReadonlyArray<Readonly<{ value: string }>>;
      subject: Readonly<{ reference: string }>;
      sender: Readonly<{ reference: string }>;
      sent: string;
      reasonCode: ReadonlyArray<Readonly<{ coding: ReadonlyArray<Readonly<{ code: string }>> }>>;
      payload: ReadonlyArray<Readonly<{ contentString: string }>>;
    }>;
  }>): Promise<{ notificationId: string }>;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function emergencyConsentClaimsHash(consent: Record<string, unknown>): string {
  return digest(canonicalize(Object.fromEntries(Object.entries(consent)
    .filter(([key]) => key === '@context' || key.startsWith('Consent.')))));
}

function resolveConsentLifetimeSeconds(configured: number | string | undefined): number {
  const parsed = Number(configured ?? 86_400);
  if (!Number.isFinite(parsed)) return 86_400;
  return Math.max(900, Math.min(86_400, Math.floor(parsed)));
}

export class BreakGlassService implements BreakGlassAuthorizer {
  constructor(
    private readonly blockchainAdapter: IBlockchainAdapter,
    private readonly vaultRepository: IVaultRepository,
    private readonly notifier: BreakGlassControllerNotifier,
    private readonly clock: () => Date = () => new Date(),
    private readonly options: BreakGlassServiceOptions = {},
  ) {}

  async authorize(input: BreakGlassAuthorizationInput): Promise<BreakGlassAuthorization> {
    if (!input.professionalCredentialVerified || !input.ledgerVerified) throw new Error('verified_professional_credential_required');
    if (!String(input.actorOrganizationDid || '').trim()) throw new Error('requester_organization_required');
    if (!matchesBreakGlassSubjectKind(
      input.subjectDid,
      input.request.subjectKind,
      this.options.subjectKindMatchers,
    )) throw new Error('subject_kind_mismatch');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.request.incidentId)) throw new Error('invalid_incident_id');
    const justification = input.request.justification.trim();
    if (justification.length < 10 || justification.length > 500) throw new Error('invalid_emergency_justification');
    const decision = evaluateBreakGlassPolicy({
      routeSector: input.routeSector,
      subjectKind: input.request.subjectKind,
      professionalRole: input.professionalRole,
      requestedScope: input.requestedScope,
      reasonCode: input.request.reasonCode,
    });
    if (!decision.allowed) throw new Error(decision.reason);
    if (!this.blockchainAdapter.registerArtifactBundle) throw new Error('break_glass_ledger_not_configured');

    const issuedAtDate = this.clock();
    const lifetimeSeconds = Math.max(1, Math.min(decision.maxLifetimeSeconds, input.requestedLifetimeSeconds));
    const issuedAt = issuedAtDate.toISOString();
    const channel = resolveClinicalDataChannel(input.routeSector, input.jurisdiction);
    const tenantVaultId = getTenantVaultId(input.routeSector, input.tenantId);
    const consentSectionId = getIndividualSectionId(input.subjectDid, 'emergency_consents');
    const consentStorageId = digest([
      input.tenantId,
      input.routeSector,
      input.actorDid,
      input.subjectDid,
      input.request.incidentId,
    ].join('|'));
    let consent = await this.vaultRepository.get<EmergencyConsentRecord>(
      tenantVaultId,
      consentStorageId,
      consentSectionId,
    );
    let notificationId: string | undefined;

    if (consent) {
      if (String(consent[ClaimConsent.status]) !== 'active'
        || String(consent[ClaimConsent.decision]) !== ConsentDecisions.Permit) {
        throw new Error('emergency_consent_not_active');
      }
      if (String(consent[ClaimConsent.actorIdentifier]) !== input.actorDid
        || String(consent[ClaimConsent.actorRole]) !== input.professionalRole
        || String(consent[ClaimConsent.subject]) !== input.subjectDid) {
        throw new Error('emergency_consent_actor_mismatch');
      }
      if (String(consent[ClaimConsent.action]) !== input.requestedScope) {
        throw new Error('emergency_consent_scope_mismatch');
      }
      if (Date.parse(String(consent[ClaimConsent.periodEnd] || '')) <= issuedAtDate.getTime()) {
        throw new Error('emergency_consent_expired');
      }
    } else {
      const consentLifetimeSeconds = resolveConsentLifetimeSeconds(
        this.options.consentLifetimeSeconds ?? process.env.BREAK_GLASS_CONSENT_TTL_SECONDS,
      );
      const emergencyConsentId = randomUUID();
      const consentExpiresAt = new Date(issuedAtDate.getTime() + consentLifetimeSeconds * 1000).toISOString();
      consent = {
        id: consentStorageId,
        '@context': 'org.hl7.fhir.api',
        [ClaimConsent.identifier]: `urn:uuid:${emergencyConsentId}`,
        [ClaimConsent.status]: 'active',
        [ClaimConsent.decision]: ConsentDecisions.Permit,
        [ClaimConsent.subject]: input.subjectDid,
        [ClaimConsent.actorIdentifier]: input.actorDid,
        [ClaimConsent.actorRole]: input.professionalRole,
        [ClaimConsent.purpose]: HealthcareConsentPurposes.EmergencyTreatment,
        [ClaimConsent.action]: input.requestedScope,
        [ClaimConsent.date]: issuedAt,
        [ClaimConsent.periodStart]: issuedAt,
        [ClaimConsent.periodEnd]: consentExpiresAt,
        [ClaimConsent.eventBasedOn]: `urn:sha256:${digest(input.request.incidentId)}`,
        [ClaimConsent.provisionCode]: input.request.reasonCode,
        notificationIdHash: '',
      };

      await this.blockchainAdapter.registerArtifactBundle({
        assetId: `break-glass-consent:${emergencyConsentId}`,
        channel,
        payload: {
          type: 'BreakGlassEmergencyConsent',
          emergencyConsentId,
          consentClaimsHash: emergencyConsentClaimsHash(consent),
          incidentIdHash: digest(input.request.incidentId),
          actorDidHash: digest(input.actorDid),
          requesterOrganizationDid: input.actorOrganizationDid,
          jurisdiction: input.jurisdiction,
          subjectDidHash: digest(input.subjectDid),
          professionalRole: input.professionalRole,
          routeSector: input.routeSector,
          subjectKind: input.request.subjectKind,
          reasonCode: input.request.reasonCode,
          authorizedScopeHash: digest(input.requestedScope),
          issuedAt,
          expiresAt: consentExpiresAt,
          controllerNotification: 'pending',
        },
      });

      const notification = await this.notifier.notify({
        authorizationId: emergencyConsentId,
        incidentId: input.request.incidentId,
        requesterOrganizationDid: input.actorOrganizationDid,
        jurisdiction: input.jurisdiction,
        professionalActorHash: digest(input.actorDid),
        professionalRole: input.professionalRole,
        subjectDid: input.subjectDid,
        routeSector: input.routeSector,
        reasonCode: input.request.reasonCode,
        issuedAt,
        expiresAt: consentExpiresAt,
        consentLedgerAssetId: `break-glass-consent:${emergencyConsentId}`,
        communication: {
          resourceType: ResourceTypesFhirR4.Communication,
          status: 'in-progress',
          identifier: [{ value: `urn:uuid:${emergencyConsentId}` }],
          subject: { reference: input.subjectDid },
          sender: { reference: input.actorOrganizationDid },
          sent: issuedAt,
          reasonCode: [{ coding: [{ code: input.request.reasonCode }] }],
          payload: [{
            contentString: JSON.stringify({
              emergencyConsentId,
              consentLedgerAssetId: `break-glass-consent:${emergencyConsentId}`,
              requesterOrganizationDid: input.actorOrganizationDid,
              jurisdiction: input.jurisdiction,
              professionalActorHash: digest(input.actorDid),
              professionalRole: input.professionalRole,
              validFrom: issuedAt,
              validUntil: consentExpiresAt,
            }),
          }],
        },
      });
      notificationId = notification.notificationId;
      consent.notificationIdHash = digest(notification.notificationId);

      await this.blockchainAdapter.registerArtifactBundle({
        assetId: `break-glass-consent:${emergencyConsentId}:notification:${digest(notification.notificationId).slice(0, 24)}`,
        channel,
        payload: {
          type: 'BreakGlassControllerNotification',
          emergencyConsentId,
          requesterOrganizationDid: input.actorOrganizationDid,
          jurisdiction: input.jurisdiction,
          notificationIdHash: digest(notification.notificationId),
          acknowledgedAt: this.clock().toISOString(),
        },
      });
      await this.vaultRepository.put(tenantVaultId, [consent], consentSectionId);
    }

    const emergencyConsentId = String(consent[ClaimConsent.identifier]).replace(/^urn:uuid:/, '');
    const consentExpiresAt = String(consent[ClaimConsent.periodEnd]);
    const authorizationId = randomUUID();
    const auditAssetId = `break-glass:${authorizationId}`;
    const expiresAt = new Date(Math.min(
      issuedAtDate.getTime() + lifetimeSeconds * 1000,
      Date.parse(consentExpiresAt),
    )).toISOString();

    await this.blockchainAdapter.registerArtifactBundle({
      assetId: auditAssetId,
      channel,
      payload: {
        type: 'BreakGlassTokenAuthorization',
        emergencyConsentId,
        authorizationId,
        incidentIdHash: digest(input.request.incidentId),
        actorDidHash: digest(input.actorDid),
        requesterOrganizationDid: input.actorOrganizationDid,
        jurisdiction: input.jurisdiction,
        subjectDidHash: digest(input.subjectDid),
        professionalRole: input.professionalRole,
        routeSector: input.routeSector,
        subjectKind: input.request.subjectKind,
        reasonCode: input.request.reasonCode,
        requestedScopeHash: digest(input.requestedScope),
        requestingClientIdHash: digest(input.requestingClientId),
        tokenAudienceHash: digest(input.tokenAudience),
        issuedAt,
        expiresAt,
        controllerNotification: 'acknowledged',
      },
    });

    return {
      emergencyConsentId,
      consentExpiresAt,
      authorizationId,
      issuedAt,
      expiresAt,
      lifetimeSeconds: Math.max(1, Math.floor((Date.parse(expiresAt) - issuedAtDate.getTime()) / 1000)),
      auditAssetId,
      notificationId,
    };
  }
}

class BreakGlassControllerNotifierHttp implements BreakGlassControllerNotifier {
  constructor(private readonly endpoint: string, private readonly bearerToken: string) {}

  async notify(input: Parameters<BreakGlassControllerNotifier['notify']>[0]): Promise<{ notificationId: string }> {
    const response = await fetch(this.endpoint, {
      method: HttpRequestMethods.Post,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.bearerToken}` },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`break_glass_notification_http_${response.status}`);
    const value = await response.json() as Record<string, unknown>;
    const notificationId = String(value.notificationId || '').trim();
    if (!notificationId) throw new Error('break_glass_notification_invalid');
    return { notificationId };
  }
}

export function buildBreakGlassAuthorizer(
  blockchainAdapter: IBlockchainAdapter,
  vaultRepository: IVaultRepository,
  subjectKindMatchers: readonly BreakGlassSubjectKindMatcher[] = [],
): BreakGlassAuthorizer | undefined {
  if (String(process.env.BREAK_GLASS_ENABLED || '').trim().toLowerCase() !== 'true') return undefined;
  const endpoint = String(process.env.BREAK_GLASS_NOTIFICATION_URL || '').trim();
  const bearerToken = String(process.env.BREAK_GLASS_NOTIFICATION_TOKEN || '').trim();
  if (!endpoint || !bearerToken) throw new Error('break_glass_notification_not_configured');
  return new BreakGlassService(
    blockchainAdapter,
    vaultRepository,
    new BreakGlassControllerNotifierHttp(endpoint, bearerToken),
    () => new Date(),
    { subjectKindMatchers },
  );
}
