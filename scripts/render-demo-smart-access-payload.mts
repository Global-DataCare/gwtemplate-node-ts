import {
  DEMO_SMART_ACCESS_LOCAL_DIDS,
  buildDemoDigitalTwinCompositionSearchRequest,
  buildDemoIndividualIpsPermitConsent,
  buildDemoIndividualIpsSearchRequest,
  buildDemoIndividualSmartTokenRequest,
  buildDemoResearchPermitByEmailConsent,
  buildDemoResearchPermitByRoleConsent,
  buildDemoResearchRequesterMatrix,
  buildDemoResearchSmartTokenRequest,
  buildDemoSecretaryIpsPermitConsent,
  buildDemoSecretaryIpsSearchRequest,
  buildDemoSecretarySmartTokenRequest,
} from '../src/__tests__/data/demo-smart-access-local-network.data.ts';
import { buildConsentRulePrimaryDocument } from '../src/utils/consent-access-blockchain.ts';
import { getClaimValue, normalizeContextualizedClaims } from '../src/utils/claims.ts';
import { expandConsentActorRoles } from '../src/utils/consent.ts';
import { ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import type { BundleEntry } from 'gdc-common-utils-ts/models/bundle';

type PayloadName =
  | 'INDIVIDUAL_CONSENT_BATCH_REQUEST'
  | 'INDIVIDUAL_RULE_ID_LIST'
  | 'INDIVIDUAL_SMART_TOKEN_REQUEST'
  | 'INDIVIDUAL_IPS_SEARCH_REQUEST'
  | 'SECRETARY_CONSENT_BATCH_REQUEST'
  | 'SECRETARY_RULE_ID_LIST'
  | 'SECRETARY_SMART_TOKEN_REQUEST_ALLOW'
  | 'SECRETARY_SMART_TOKEN_REQUEST_DENY'
  | 'SECRETARY_IPS_SEARCH_REQUEST'
  | 'RESEARCH_CONSENT_BATCH_REQUEST_ROLE'
  | 'RESEARCH_RULE_ID_LIST_ROLE'
  | 'RESEARCH_CONSENT_BATCH_REQUEST_EMAIL'
  | 'RESEARCH_RULE_ID_LIST_EMAIL'
  | 'RESEARCH_SMART_TOKEN_REQUEST_ROLE_ALLOW'
  | 'RESEARCH_SMART_TOKEN_REQUEST_ROLE_DENY'
  | 'RESEARCH_SMART_TOKEN_REQUEST_EMAIL_ALLOW'
  | 'RESEARCH_SMART_TOKEN_REQUEST_EMAIL_DENY'
  | 'DIGITAL_TWIN_COMPOSITION_SEARCH_REQUEST'
  | 'RESEARCH_CONSUMER_ORGANIZATION_DID';

const payloadName = process.argv[2] as PayloadName | undefined;

if (!payloadName) {
  throw new Error(
    'Usage: render-demo-smart-access-payload.mts <INDIVIDUAL_*|SECRETARY_*|RESEARCH_*|DIGITAL_TWIN_COMPOSITION_SEARCH_REQUEST|RESEARCH_CONSUMER_ORGANIZATION_DID>',
  );
}

const tenantId = process.env.TENANT_ID || 'acme-id';
const subjectDid = process.env.SUBJECT_ID || `did:web:api.${tenantId}.org:individual:subject-001`;
const clientAssertionAudience = process.env.SMART_TOKEN_AUDIENCE;
const providerOrganizationDid = process.env.PROVIDER_ORGANIZATION_DID;

function buildConsentEntry(resourceClaims: Record<string, unknown>): BundleEntry {
  return {
    id: String(resourceClaims['Consent.identifier'] || ''),
    type: 'Consent',
    resource: {
      resourceType: 'Consent',
      status: 'active',
      meta: {
        claims: resourceClaims,
      },
    },
  } as BundleEntry;
}

function buildProjectedConsentEntry(resourceClaims: Record<string, unknown>): BundleEntry {
  const claims = normalizeContextualizedClaims(resourceClaims);
  const actorRoles = getClaimValue<string>(claims, ClaimConsent.actorRole);
  if (actorRoles) {
    const context = String(claims['@context'] || '').replace(/\.$/, '');
    const contextualizedKey = context ? `${context}.${ClaimConsent.actorRole}` : ClaimConsent.actorRole;
    const targetKey = claims[contextualizedKey] !== undefined
      ? contextualizedKey
      : ClaimConsent.actorRole;
    claims[targetKey] = expandConsentActorRoles(actorRoles, 'auto').join(',');
  }
  return buildConsentEntry(claims);
}

function buildConsentBatch(resourceClaims: Record<string, unknown>): { thid: string; data: BundleEntry[] } {
  const entry = buildConsentEntry(resourceClaims);
  return {
    thid: process.env.THID || `smart-access-${String(entry.id || 'consent').replace(/[^a-zA-Z0-9-]+/g, '-')}`,
    data: [entry],
  };
}

const matrix = buildDemoResearchRequesterMatrix();

const rendered = await (async () => {
  switch (payloadName) {
    case 'INDIVIDUAL_CONSENT_BATCH_REQUEST':
      return buildConsentBatch(buildDemoIndividualIpsPermitConsent({ tenantId, subjectDid }) as Record<string, unknown>);
    case 'INDIVIDUAL_RULE_ID_LIST': {
      const entry = buildProjectedConsentEntry(
        buildDemoIndividualIpsPermitConsent({ tenantId, subjectDid }) as Record<string, unknown>,
      );
      return buildConsentRulePrimaryDocument([entry]).data.map((item) => item.id);
    }
    case 'INDIVIDUAL_SMART_TOKEN_REQUEST':
      return buildDemoIndividualSmartTokenRequest({ tenantId, subjectDid, clientAssertionAudience });
    case 'INDIVIDUAL_IPS_SEARCH_REQUEST':
      return buildDemoIndividualIpsSearchRequest({ subjectDid });
    case 'SECRETARY_CONSENT_BATCH_REQUEST':
      return buildConsentBatch(buildDemoSecretaryIpsPermitConsent({ tenantId, subjectDid }) as Record<string, unknown>);
    case 'SECRETARY_RULE_ID_LIST': {
      const entry = buildProjectedConsentEntry(
        buildDemoSecretaryIpsPermitConsent({ tenantId, subjectDid }) as Record<string, unknown>,
      );
      return buildConsentRulePrimaryDocument([entry]).data.map((item) => item.id);
    }
    case 'SECRETARY_SMART_TOKEN_REQUEST_ALLOW':
      return buildDemoSecretarySmartTokenRequest({
        tenantId, subjectDid, allowed: true, clientAssertionAudience,
      });
    case 'SECRETARY_SMART_TOKEN_REQUEST_DENY':
      return buildDemoSecretarySmartTokenRequest({
        tenantId, subjectDid, allowed: false, clientAssertionAudience,
      });
    case 'SECRETARY_IPS_SEARCH_REQUEST':
      return buildDemoSecretaryIpsSearchRequest({ subjectDid });
    case 'RESEARCH_CONSENT_BATCH_REQUEST_ROLE': {
      return buildConsentBatch(buildDemoResearchPermitByRoleConsent({ subjectDid }) as Record<string, unknown>);
    }
    case 'RESEARCH_RULE_ID_LIST_ROLE': {
      const entry = buildProjectedConsentEntry(
        buildDemoResearchPermitByRoleConsent({ subjectDid }) as Record<string, unknown>,
      );
      return buildConsentRulePrimaryDocument([entry]).data.map((item) => item.id);
    }
    case 'RESEARCH_CONSENT_BATCH_REQUEST_EMAIL': {
      return buildConsentBatch(buildDemoResearchPermitByEmailConsent({ subjectDid }) as Record<string, unknown>);
    }
    case 'RESEARCH_RULE_ID_LIST_EMAIL': {
      const entry = buildProjectedConsentEntry(
        buildDemoResearchPermitByEmailConsent({ subjectDid }) as Record<string, unknown>,
      );
      return buildConsentRulePrimaryDocument([entry]).data.map((item) => item.id);
    }
    case 'RESEARCH_SMART_TOKEN_REQUEST_ROLE_ALLOW':
      return buildDemoResearchSmartTokenRequest({
        tenantId, subjectDid, clientAssertionAudience, providerOrganizationDid, ...matrix.allowByRole,
      });
    case 'RESEARCH_SMART_TOKEN_REQUEST_ROLE_DENY':
      return buildDemoResearchSmartTokenRequest({
        tenantId, subjectDid, clientAssertionAudience, providerOrganizationDid, ...matrix.denyByRole,
      });
    case 'RESEARCH_SMART_TOKEN_REQUEST_EMAIL_ALLOW':
      return buildDemoResearchSmartTokenRequest({
        tenantId, subjectDid, clientAssertionAudience, providerOrganizationDid, ...matrix.allowByEmail,
      });
    case 'RESEARCH_SMART_TOKEN_REQUEST_EMAIL_DENY':
      return buildDemoResearchSmartTokenRequest({
        tenantId, subjectDid, clientAssertionAudience, providerOrganizationDid, ...matrix.denyByEmail,
      });
    case 'DIGITAL_TWIN_COMPOSITION_SEARCH_REQUEST':
      return buildDemoDigitalTwinCompositionSearchRequest();
    case 'RESEARCH_CONSUMER_ORGANIZATION_DID':
      return DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid;
    default:
      throw new Error(`Unknown payload '${payloadName}'.`);
  }
})();

process.stdout.write(JSON.stringify(rendered));
