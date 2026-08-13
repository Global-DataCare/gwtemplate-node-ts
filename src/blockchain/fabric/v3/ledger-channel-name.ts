/**
 * Generic Fabric channel-name primitives.
 *
 * Product adapters select the channel family and subject domain. Core only
 * validates the stable region suffix and construction rules.
 */
export const LedgerRegions = Object.freeze({
  EU: 'eu',
  NA: 'na',
  ASIA: 'asia',
  AFRICA: 'africa',
  PACIFIC: 'pacific',
  LATAM: 'latam',
} as const);

export type LedgerRegion = typeof LedgerRegions[keyof typeof LedgerRegions];

export const GLOBAL_HUMAN_IDENTITY_CHANNEL = 'identity-global' as const;
export const EU_ORGANIZATION_IDENTITY_CHANNEL = 'identity-eu' as const;

export type PolicyOwnerKind = 'individual' | 'animal' | 'organization';
export type CareOrganizationKind = 'human' | 'animal';

const CHANNEL_FAMILY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Builds a channel name with the jurisdictional region in the final segment.
 */
export function buildRegionalLedgerChannel(
  channelFamily: string,
  region: LedgerRegion,
): string {
  const family = String(channelFamily || '').trim().toLowerCase();
  if (!CHANNEL_FAMILY_PATTERN.test(family)) {
    throw new Error('Invalid Fabric channel family');
  }
  if (!Object.values(LedgerRegions).includes(region)) {
    throw new Error('Invalid Fabric ledger region');
  }
  return family + '-' + region;
}

/**
 * Resolves the ledger plane that owns a policy.
 *
 * This must not be inferred from the provider's route sector: individual
 * policy remains with human identity, animal policy remains with the animal
 * subject plane, and organization policy belongs to regional antifraud
 * governance.
 */
export function buildPolicyOwnerLedgerChannel(
  ownerKind: PolicyOwnerKind,
  region: LedgerRegion,
): string {
  if (ownerKind === 'individual') return GLOBAL_HUMAN_IDENTITY_CHANNEL;
  if (ownerKind === 'animal') return buildRegionalLedgerChannel('animal-pet', region);
  return buildRegionalLedgerChannel('antifraud', region);
}

/**
 * Resolves the sector plane for care-provider organizations and services.
 * These channels do not replace the individual or animal policy planes.
 */
export function buildCareOrganizationLedgerChannel(
  careKind: CareOrganizationKind,
  region: LedgerRegion,
): string {
  return buildRegionalLedgerChannel(
    careKind === 'human' ? 'health-care' : 'animal-care',
    region,
  );
}
