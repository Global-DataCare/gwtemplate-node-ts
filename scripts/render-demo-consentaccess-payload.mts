import {
  EXAMPLE_CONSENT_ACCESS_RULES,
} from 'gdc-common-utils-ts/examples/consent-access';
import {
  EXAMPLE_CONSENT_ATTACHMENT_CONTENT_TYPE,
  EXAMPLE_CONSENT_ATTACHMENT_DATA_BASE64,
  EXAMPLE_SUBJECT_DID,
} from 'gdc-common-utils-ts/examples/shared';
import { ClaimConsent, type ConsentRule } from 'gdc-common-utils-ts/models/consent-rule';
import { buildConsentRulePrimaryDocument } from 'gdc-common-utils-ts/utils/permission-templates';
import type { BundleEntry } from 'gdc-common-utils-ts/models/bundle';

type RenderMode =
  | 'CONSENT_BATCH_REQUEST'
  | 'RULE_ID_LIST'
  | 'CONSENT_BATCH_REQUEST_DUPLICATE'
  | 'RULE_ID_LIST_DUPLICATE'
  | 'CONSENT_LIFECYCLE_ACTIVATE_REQUEST'
  | 'CONSENT_LIFECYCLE_REVOKE_REQUEST'
  | 'CONSENT_LIFECYCLE_REACTIVATE_REQUEST'
  | 'RULE_ID_LIST_LIFECYCLE';

/**
 * Renderer used by the local Fabric smoke for `consentaccess-sc`.
 *
 * Why this exists:
 * - the smoke must reuse the same canonical consent examples as `common-utils`
 * - the API request must still be a bundle of `Consent` entries
 * - the blockchain projection must derive atomic rule entries from that bundle
 * - the duplicate scenario must repeat one already-created rule id on purpose
 */
const payloadName = process.argv[2] as RenderMode | undefined;

if (!payloadName) {
  throw new Error('Usage: render-demo-consentaccess-payload.mts <CONSENT_BATCH_REQUEST|RULE_ID_LIST|CONSENT_LIFECYCLE_ACTIVATE_REQUEST|CONSENT_LIFECYCLE_REVOKE_REQUEST|CONSENT_LIFECYCLE_REACTIVATE_REQUEST|RULE_ID_LIST_LIFECYCLE>');
}

const DEFAULT_THID = 'consentaccess-local-network-three-consents' as const;
const DEFAULT_DUPLICATE_THID = 'consentaccess-local-network-three-consents-duplicate' as const;
const DEFAULT_RESOURCE_TYPE = 'Consent' as const;
const DEFAULT_RESOURCE_STATUS = 'active' as const;

/**
 * These three consent fixtures are the canonical shared rules reused by the
 * local end-to-end smoke test. The payload sent to GW CORE is therefore built
 * from the same consent examples that already drive common-utils tests.
 */
const EXAMPLE_LOCAL_SMOKE_CONSENT_RULES = Object.freeze([
  EXAMPLE_CONSENT_ACCESS_RULES.physicianByEmailContinuousCare,
  EXAMPLE_CONSENT_ACCESS_RULES.physicianByOrganizationContinuousCare,
  EXAMPLE_CONSENT_ACCESS_RULES.physicianByJurisdictionEmergency,
]);

/**
 * The duplicate smoke intentionally repeats the physician-by-email rule while
 * adding two new rules. This allows the end-to-end smoke to verify both:
 * - independent writes for new atomic rules
 * - smart-contract no-op behavior when one hashed rule id already exists
 */
const EXAMPLE_LOCAL_SMOKE_CONSENT_RULES_WITH_DUPLICATE = Object.freeze([
  EXAMPLE_CONSENT_ACCESS_RULES.physicianByEmailContinuousCare,
  EXAMPLE_CONSENT_ACCESS_RULES.nurseByOrganization,
  EXAMPLE_CONSENT_ACCESS_RULES.physicianByEmailEmergency,
]);

/**
 * The lifecycle smoke intentionally uses one single atomic rule across three
 * states. The active and reactivated payloads are identical; the revoked one
 * differs only by the presence of `Consent.period-end`, which changes the
 * blockchain lifecycle status but not the hashed rule id.
 */
const EXAMPLE_LOCAL_SMOKE_CONSENT_RULE_LIFECYCLE = Object.freeze({
  activate: EXAMPLE_CONSENT_ACCESS_RULES.physicianByEmailEmergency,
  revoke: EXAMPLE_CONSENT_ACCESS_RULES.revokedPhysicianEmailConsent,
  reactivate: EXAMPLE_CONSENT_ACCESS_RULES.physicianByEmailEmergency,
});

function buildConsentClaims(rule: ConsentRule): ConsentRule {
  return {
    ...rule,
    [ClaimConsent.subject]: process.env.SUBJECT_ID || EXAMPLE_SUBJECT_DID,
    [ClaimConsent.attachmentContentType]: EXAMPLE_CONSENT_ATTACHMENT_CONTENT_TYPE,
    [ClaimConsent.attachmentData]: EXAMPLE_CONSENT_ATTACHMENT_DATA_BASE64,
  };
}

function buildConsentEntry(rule: ConsentRule): BundleEntry {
  const claims = buildConsentClaims(rule);
  return {
    id: String(claims[ClaimConsent.identifier]),
    type: DEFAULT_RESOURCE_TYPE,
    resource: {
      resourceType: DEFAULT_RESOURCE_TYPE,
      status: DEFAULT_RESOURCE_STATUS,
      meta: {
        claims,
      },
    },
  } as BundleEntry;
}

function buildConsentEntries(): BundleEntry[] {
  return EXAMPLE_LOCAL_SMOKE_CONSENT_RULES.map((rule) => buildConsentEntry(rule));
}

function buildDuplicateConsentEntries(): BundleEntry[] {
  return EXAMPLE_LOCAL_SMOKE_CONSENT_RULES_WITH_DUPLICATE.map((rule) => buildConsentEntry(rule));
}

function buildLifecycleConsentEntries() {
  return {
    activate: [buildConsentEntry(EXAMPLE_LOCAL_SMOKE_CONSENT_RULE_LIFECYCLE.activate)],
    revoke: [buildConsentEntry(EXAMPLE_LOCAL_SMOKE_CONSENT_RULE_LIFECYCLE.revoke)],
    reactivate: [buildConsentEntry(EXAMPLE_LOCAL_SMOKE_CONSENT_RULE_LIFECYCLE.reactivate)],
  } as const;
}

const rendered = (() => {
  switch (payloadName) {
    case 'CONSENT_BATCH_REQUEST':
      return {
        thid: process.env.THID || DEFAULT_THID,
        data: buildConsentEntries(),
      };
    case 'RULE_ID_LIST':
      return buildConsentRulePrimaryDocument(buildConsentEntries()).data.map((entry) => entry.id);
    case 'CONSENT_BATCH_REQUEST_DUPLICATE':
      return {
        thid: process.env.THID || DEFAULT_DUPLICATE_THID,
        data: buildDuplicateConsentEntries(),
      };
    case 'RULE_ID_LIST_DUPLICATE':
      return buildConsentRulePrimaryDocument(buildDuplicateConsentEntries()).data.map((entry) => entry.id);
    case 'CONSENT_LIFECYCLE_ACTIVATE_REQUEST':
      return {
        thid: process.env.THID || `${DEFAULT_THID}-lifecycle-activate`,
        data: buildLifecycleConsentEntries().activate,
      };
    case 'CONSENT_LIFECYCLE_REVOKE_REQUEST':
      return {
        thid: process.env.THID || `${DEFAULT_THID}-lifecycle-revoke`,
        data: buildLifecycleConsentEntries().revoke,
      };
    case 'CONSENT_LIFECYCLE_REACTIVATE_REQUEST':
      return {
        thid: process.env.THID || `${DEFAULT_THID}-lifecycle-reactivate`,
        data: buildLifecycleConsentEntries().reactivate,
      };
    case 'RULE_ID_LIST_LIFECYCLE':
      return buildConsentRulePrimaryDocument(buildLifecycleConsentEntries().activate).data.map((entry) => entry.id);
    default:
      throw new Error(`Unknown payload '${payloadName}'.`);
  }
})();

process.stdout.write(JSON.stringify(rendered));
