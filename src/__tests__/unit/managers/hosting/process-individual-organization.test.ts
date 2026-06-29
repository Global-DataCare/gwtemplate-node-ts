import { describe, expect, it, jest } from '@jest/globals';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { ClaimsOfferSchemaorg, ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { JobStatus, type JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import {
  processIndividualOrganizationRegistrationEntry,
} from '../../../../managers/hosting/process-individual-organization';

describe('processIndividualOrganizationRegistrationEntry', () => {
  function buildJob(): JobRequest {
    return {
      id: 'job-individual-registration-001',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId: 'acme-health',
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: { body: { data: [] } } as any,
    } as JobRequest;
  }

  it('creates only the deprecated embedded administrative registration, not a controller-ready onboarding result', async () => {
    const protectConfidentialData = jest.fn(async (doc: unknown) => doc);
    const put = jest.fn(async () => undefined);

    const response = await processIndividualOrganizationRegistrationEntry({
      job: buildJob(),
      entry: {
        type: 'Family-registration-request-v1.0',
        meta: {
          claims: {
            [ClaimsOrganizationSchemaorg.alternateName]: 'ana-story',
            'org.schema.Organization.owner.email': 'adult1@example.com',
            [ClaimsServiceSchemaorg.category]: Sector.HEALTH_CARE,
          },
        },
      } as any,
      environment: 'test',
      tenantsCacheManager: {
        getTenant: jest.fn(async () => ({
          networkStatus: [{ networkName: 'test', status: 'active' }],
        })),
        getCollectionName: jest.fn(async () => 'health-care_acme-health'),
      },
      vaultRepository: {
        query: jest.fn(async () => []),
        put,
      },
      kmsService: {
        protectConfidentialData,
      },
      extractResources: jest.fn((claims) => ({
        organization: {
          id: 'individual-org-001',
          meta: { claims },
        },
      })),
    });

    const responseClaims = response.meta?.claims || {};

    // Step 1: the deprecated embedded flow persists only the administrative
    // subject registration inside an existing tenant.
    expect(response.response?.status).toBe('201');
    expect(put).toHaveBeenCalledTimes(1);
    // Step 2: it signals lifecycle status only, not a commercial Offer.
    expect(responseClaims['org.schema.FamilyRegistration.status']).toBe('new_created');
    expect(responseClaims[ClaimsOfferSchemaorg.identifier]).toBeUndefined();
    // Step 3: the absence of Offer is part of the contract, so callers must
    // not attempt a follow-up `Order/_batch`.
    expect((response as any).resource?.next).toBeUndefined();
    // Step 4: this also means the flow must not be misread as a full
    // controller onboarding with wallet/profile/device/key activation.
  });
});
