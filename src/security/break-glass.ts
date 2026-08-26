import { createHash, randomUUID } from 'node:crypto';
import type { IBlockchainAdapter } from '../adapters/IBlockchainAdapter';

export type BreakGlassSubjectKind = 'human' | 'animal';
export type BreakGlassReasonCode =
  | 'life-threatening'
  | 'serious-imminent-harm'
  | 'unconscious-or-incapacitated'
  | 'animal-emergency';

export type BreakGlassRequest = Readonly<{
  incidentId: string;
  subjectKind: BreakGlassSubjectKind;
  reasonCode: BreakGlassReasonCode;
  justification: string;
}>;

export type BreakGlassPolicyInput = Readonly<{
  routeSector: string;
  subjectKind: BreakGlassSubjectKind;
  professionalRole: string;
  requestedScope: string;
  reasonCode: BreakGlassReasonCode;
}>;

export type BreakGlassPolicyDecision =
  | Readonly<{ allowed: true; maxLifetimeSeconds: 900 }>
  | Readonly<{ allowed: false; reason: string }>;

const HUMAN_EMERGENCY_ROLES = /^221(?:\d)?$/;
const ANIMAL_EMERGENCY_ROLES = /^2250$/;
const RESEARCH_SECTORS = new Set(['health-research', 'animal-research', 'onehealth-research']);

function occupationCode(value: string): string {
  const normalized = String(value || '').trim();
  return (normalized.includes('|') ? normalized.slice(normalized.lastIndexOf('|') + 1) : normalized)
    .replace(/[^0-9]/g, '');
}

function isReadOnlyScope(scope: string): boolean {
  const tokens = String(scope || '').split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => {
    const head = token.split('?', 1)[0] || '';
    const permission = head.slice(head.lastIndexOf('.') + 1).toLowerCase();
    return permission === 'r' || permission === 'rs';
  });
}

function subjectDidMatchesKind(subjectDid: string, subjectKind: BreakGlassSubjectKind): boolean {
  const normalized = String(subjectDid || '').trim().toLowerCase();
  return subjectKind === 'human'
    ? normalized.includes(':individual:')
    : normalized.includes(':card:uhc:animal:') || normalized.includes(':animal:');
}

/**
 * Product-neutral, sector-first emergency policy. Organization membership,
 * employment and research authority never imply exceptional access.
 */
export function evaluateBreakGlassPolicy(input: BreakGlassPolicyInput): BreakGlassPolicyDecision {
  const routeSector = String(input.routeSector || '').trim().toLowerCase();
  if (RESEARCH_SECTORS.has(routeSector)) return { allowed: false, reason: 'research_sector_forbidden' };
  if (!isReadOnlyScope(input.requestedScope)) return { allowed: false, reason: 'read_only_scope_required' };

  const role = occupationCode(input.professionalRole);
  if (input.subjectKind === 'human') {
    if (routeSector !== 'health-care') return { allowed: false, reason: 'human_sector_mismatch' };
    if (!HUMAN_EMERGENCY_ROLES.test(role)) return { allowed: false, reason: 'professional_role_not_authorized' };
    if (input.reasonCode === 'animal-emergency') return { allowed: false, reason: 'reason_subject_mismatch' };
    return { allowed: true, maxLifetimeSeconds: 900 };
  }

  if (routeSector !== 'animal-care') return { allowed: false, reason: 'animal_sector_mismatch' };
  if (!ANIMAL_EMERGENCY_ROLES.test(role)) return { allowed: false, reason: 'professional_role_not_authorized' };
  if (input.reasonCode !== 'animal-emergency') return { allowed: false, reason: 'reason_subject_mismatch' };
  return { allowed: true, maxLifetimeSeconds: 900 };
}

export type BreakGlassAuthorizationInput = Readonly<{
  tenantId: string;
  jurisdiction: string;
  routeSector: string;
  actorDid: string;
  professionalRole: string;
  subjectDid: string;
  requestedScope: string;
  request: BreakGlassRequest;
  professionalCredentialVerified: boolean;
  ledgerVerified: boolean;
  requestedLifetimeSeconds: number;
}>;

export type BreakGlassAuthorization = Readonly<{
  authorizationId: string;
  issuedAt: string;
  expiresAt: string;
  lifetimeSeconds: number;
  auditAssetId: string;
  notificationId: string;
}>;

export interface BreakGlassAuthorizer {
  authorize(input: BreakGlassAuthorizationInput): Promise<BreakGlassAuthorization>;
}

export interface BreakGlassControllerNotifier {
  notify(input: Readonly<{
    authorizationId: string;
    incidentId: string;
    actorDid: string;
    professionalRole: string;
    subjectDid: string;
    routeSector: string;
    reasonCode: BreakGlassReasonCode;
    justification: string;
    issuedAt: string;
    expiresAt: string;
  }>): Promise<{ notificationId: string }>;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function jurisdictionGroup(value: string): string {
  const normalized = String(value || '').trim().toUpperCase();
  return /^(ES|FR|DE|IT|PT|NL|BE|LU|IE|AT|FI|SE|DK|PL|CZ|SK|SI|HR|HU|RO|BG|GR|CY|MT|EE|LV|LT)$/.test(normalized)
    ? 'eu'
    : normalized.toLowerCase();
}

export class BreakGlassService implements BreakGlassAuthorizer {
  constructor(
    private readonly blockchainAdapter: IBlockchainAdapter,
    private readonly notifier: BreakGlassControllerNotifier,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async authorize(input: BreakGlassAuthorizationInput): Promise<BreakGlassAuthorization> {
    if (!input.professionalCredentialVerified || !input.ledgerVerified) throw new Error('verified_professional_credential_required');
    if (!subjectDidMatchesKind(input.subjectDid, input.request.subjectKind)) throw new Error('subject_kind_mismatch');
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
    const expiresAt = new Date(issuedAtDate.getTime() + lifetimeSeconds * 1000).toISOString();
    const authorizationId = randomUUID();
    const auditAssetId = `break-glass:${authorizationId}`;
    const channel = `${input.routeSector}-${jurisdictionGroup(input.jurisdiction)}`;
    const chaincode = process.env.BREAK_GLASS_LEDGER_CHAINCODE || process.env.FHIR_ARTIFACT_LEDGER_CHAINCODE || 'artifact-sc';

    await this.blockchainAdapter.registerArtifactBundle({
      assetId: auditAssetId,
      channel,
      chaincode,
      payload: {
        type: 'BreakGlassAuthorization',
        authorizationId,
        incidentIdHash: digest(input.request.incidentId),
        actorDidHash: digest(input.actorDid),
        subjectDidHash: digest(input.subjectDid),
        professionalRole: input.professionalRole,
        routeSector: input.routeSector,
        subjectKind: input.request.subjectKind,
        reasonCode: input.request.reasonCode,
        requestedScopeHash: digest(input.requestedScope),
        issuedAt,
        expiresAt,
        controllerNotification: 'pending',
      },
    });

    const notification = await this.notifier.notify({
      authorizationId,
      incidentId: input.request.incidentId,
      actorDid: input.actorDid,
      professionalRole: input.professionalRole,
      subjectDid: input.subjectDid,
      routeSector: input.routeSector,
      reasonCode: input.request.reasonCode,
      justification,
      issuedAt,
      expiresAt,
    });

    await this.blockchainAdapter.registerArtifactBundle({
      assetId: `${auditAssetId}:notification:${digest(notification.notificationId).slice(0, 24)}`,
      channel,
      chaincode,
      payload: {
        type: 'BreakGlassControllerNotification',
        authorizationId,
        notificationIdHash: digest(notification.notificationId),
        acknowledgedAt: this.clock().toISOString(),
      },
    });

    return { authorizationId, issuedAt, expiresAt, lifetimeSeconds, auditAssetId, notificationId: notification.notificationId };
  }
}

class BreakGlassControllerNotifierHttp implements BreakGlassControllerNotifier {
  constructor(private readonly endpoint: string, private readonly bearerToken: string) {}

  async notify(input: Parameters<BreakGlassControllerNotifier['notify']>[0]): Promise<{ notificationId: string }> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
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

export function buildBreakGlassAuthorizer(blockchainAdapter: IBlockchainAdapter): BreakGlassAuthorizer | undefined {
  if (String(process.env.BREAK_GLASS_ENABLED || '').trim().toLowerCase() !== 'true') return undefined;
  const endpoint = String(process.env.BREAK_GLASS_NOTIFICATION_URL || '').trim();
  const bearerToken = String(process.env.BREAK_GLASS_NOTIFICATION_TOKEN || '').trim();
  if (!endpoint || !bearerToken) throw new Error('break_glass_notification_not_configured');
  return new BreakGlassService(blockchainAdapter, new BreakGlassControllerNotifierHttp(endpoint, bearerToken));
}
