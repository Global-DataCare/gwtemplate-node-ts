import {
  DEMO_SMART_ACCESS_LOCAL_DIDS,
  buildDemoDigitalTwinCompositionSearchRequest,
  buildDemoIndividualIpsSearchRequest,
  buildDemoIndividualSmartTokenRequest,
  buildDemoResearchPermitByEmailConsent,
  buildDemoResearchPermitByRoleConsent,
  buildDemoResearchRequesterMatrix,
  buildDemoResearchSmartTokenRequest,
} from '../src/__tests__/data/demo-smart-access-local-network.data.ts';
import { buildConsentRulePrimaryDocument } from '../../gdc-common-utils-ts/src/utils/permission-templates.ts';
import type { BundleEntry } from '../../gdc-common-utils-ts/src/models/bundle.ts';

type PayloadName =
  | 'INDIVIDUAL_SMART_TOKEN_REQUEST'
  | 'INDIVIDUAL_IPS_SEARCH_REQUEST'
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
    'Usage: render-demo-smart-access-payload.mts <INDIVIDUAL_SMART_TOKEN_REQUEST|INDIVIDUAL_IPS_SEARCH_REQUEST|RESEARCH_CONSENT_BATCH_REQUEST_ROLE|RESEARCH_RULE_ID_LIST_ROLE|RESEARCH_CONSENT_BATCH_REQUEST_EMAIL|RESEARCH_RULE_ID_LIST_EMAIL|RESEARCH_SMART_TOKEN_REQUEST_ROLE_ALLOW|RESEARCH_SMART_TOKEN_REQUEST_ROLE_DENY|RESEARCH_SMART_TOKEN_REQUEST_EMAIL_ALLOW|RESEARCH_SMART_TOKEN_REQUEST_EMAIL_DENY|DIGITAL_TWIN_COMPOSITION_SEARCH_REQUEST|RESEARCH_CONSUMER_ORGANIZATION_DID>',
  );
}

const tenantId = process.env.TENANT_ID || 'acme-id';
const subjectDid = process.env.SUBJECT_ID || `did:web:api.${tenantId}.org:individual:subject-001`;

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
    case 'INDIVIDUAL_SMART_TOKEN_REQUEST':
      return buildDemoIndividualSmartTokenRequest({ tenantId, subjectDid });
    case 'INDIVIDUAL_IPS_SEARCH_REQUEST':
      return buildDemoIndividualIpsSearchRequest({ subjectDid });
    case 'RESEARCH_CONSENT_BATCH_REQUEST_ROLE': {
      return buildConsentBatch(buildDemoResearchPermitByRoleConsent({ subjectDid }) as Record<string, unknown>);
    }
    case 'RESEARCH_RULE_ID_LIST_ROLE': {
      const entry = buildConsentEntry(buildDemoResearchPermitByRoleConsent({ subjectDid }) as Record<string, unknown>);
      return buildConsentRulePrimaryDocument([entry]).data.map((item) => item.id);
    }
    case 'RESEARCH_CONSENT_BATCH_REQUEST_EMAIL': {
      return buildConsentBatch(buildDemoResearchPermitByEmailConsent({ subjectDid }) as Record<string, unknown>);
    }
    case 'RESEARCH_RULE_ID_LIST_EMAIL': {
      const entry = buildConsentEntry(buildDemoResearchPermitByEmailConsent({ subjectDid }) as Record<string, unknown>);
      return buildConsentRulePrimaryDocument([entry]).data.map((item) => item.id);
    }
    case 'RESEARCH_SMART_TOKEN_REQUEST_ROLE_ALLOW':
      return buildDemoResearchSmartTokenRequest({ tenantId, subjectDid, ...matrix.allowByRole });
    case 'RESEARCH_SMART_TOKEN_REQUEST_ROLE_DENY':
      return buildDemoResearchSmartTokenRequest({ tenantId, subjectDid, ...matrix.denyByRole });
    case 'RESEARCH_SMART_TOKEN_REQUEST_EMAIL_ALLOW':
      return buildDemoResearchSmartTokenRequest({ tenantId, subjectDid, ...matrix.allowByEmail });
    case 'RESEARCH_SMART_TOKEN_REQUEST_EMAIL_DENY':
      return buildDemoResearchSmartTokenRequest({ tenantId, subjectDid, ...matrix.denyByEmail });
    case 'DIGITAL_TWIN_COMPOSITION_SEARCH_REQUEST':
      return buildDemoDigitalTwinCompositionSearchRequest();
    case 'RESEARCH_CONSUMER_ORGANIZATION_DID':
      return DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid;
    default:
      throw new Error(`Unknown payload '${payloadName}'.`);
  }
})();

process.stdout.write(JSON.stringify(rendered));
