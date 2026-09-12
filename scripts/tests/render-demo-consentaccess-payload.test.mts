// Flow contract: the local Fabric smoke must query the exact canonical consent rule IDs written by ConsentManager.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
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
import { expandConsentActorRoles } from '../../src/utils/consent.ts';

const smokeRules = [
  EXAMPLE_CONSENT_ACCESS_RULES.physicianByEmailContinuousCare,
  EXAMPLE_CONSENT_ACCESS_RULES.physicianByOrganizationContinuousCare,
  EXAMPLE_CONSENT_ACCESS_RULES.physicianByJurisdictionEmergency,
];

function canonicalEntry(rule: ConsentRule): BundleEntry {
  const actorRoles = String(rule[ClaimConsent.actorRole] || '');
  const claims = {
    ...rule,
    [ClaimConsent.actorRole]: expandConsentActorRoles(actorRoles, 'auto').join(','),
    [ClaimConsent.subject]: EXAMPLE_SUBJECT_DID,
    [ClaimConsent.attachmentContentType]: EXAMPLE_CONSENT_ATTACHMENT_CONTENT_TYPE,
    [ClaimConsent.attachmentData]: EXAMPLE_CONSENT_ATTACHMENT_DATA_BASE64,
  };
  return {
    id: String(claims[ClaimConsent.identifier]),
    type: 'Consent',
    resource: { resourceType: 'Consent', status: 'active', meta: { claims } },
  } as BundleEntry;
}

test('RULE_ID_LIST uses the canonical actor-role projection written to Fabric', () => {
  const rendered = JSON.parse(execFileSync(
    process.execPath,
    ['--loader', 'ts-node/esm', '--experimental-specifier-resolution=node', './scripts/render-demo-consentaccess-payload.mts', 'RULE_ID_LIST'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        TS_NODE_TRANSPILE_ONLY: '1',
        TS_NODE_SKIP_IGNORE: '1',
        TS_NODE_COMPILER_OPTIONS: '{"module":"NodeNext","moduleResolution":"NodeNext","allowImportingTsExtensions":true}',
      },
    },
  ));
  const expected = buildConsentRulePrimaryDocument(smokeRules.map(canonicalEntry)).data.map((entry) => entry.id);

  assert.deepEqual(rendered, expected);
});
