import { mock, MockProxy } from 'jest-mock-extended';

import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { LicenseManager } from '../../managers/LicenseManager';
import { getEnvSectionId } from '../../utils/section-env';

import { JobStatus, type JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import {
  buildFhirParametersResourceFromSearchParams,
  buildGwCoreTenantResourceActionPath,
  ClaimsIndividualProductSchemaorg,
  ClaimsOfferSchemaorg,
  ClaimsPersonSchemaorg,
  DeviceAppTypes,
  DeviceUserClasses,
  EXAMPLE_API_ORGANIZATION_DID,
  EXAMPLE_BUNDLE_RESOURCE_TYPE,
  EXAMPLE_BUNDLE_TYPE_BATCH,
  EXAMPLE_CONTENT_TYPE_APPLICATION_JSON,
  EXAMPLE_EMAIL_CONTROLLER_ORG,
  EXAMPLE_HEALTHCARE_ACTOR_ROLE_GENERALIST_MEDICAL_PRACTITIONER,
  EXAMPLE_JOB_IDENTIFIER_LICENSE_SEARCH,
  EXAMPLE_JURISDICTION,
  EXAMPLE_LICENSE_OFFER_ID,
  EXAMPLE_LICENSE_RUNTIME_DEFAULTS,
  EXAMPLE_LICENSE_SEAT_UUID_ACTIVE,
  EXAMPLE_LICENSE_SEAT_UUID_AVAILABLE,
  EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
  EXAMPLE_LICENSE_SUBJECT_ID_AVAILABLE,
  EXAMPLE_ROUTE_VERSION,
  EXAMPLE_SECTOR,
  EXAMPLE_SERVICE_PUBLIC_DID,
  EXAMPLE_TENANT_IDENTIFIER,
  EXAMPLE_THREAD_IDENTIFIER_LICENSE_SEARCH,
  LicenseListSearchEditor,
  LicenseCategories,
  Resource,
  Section,
  Format,
  JobAction,
  LicenseStatuses,
} from 'gdc-common-utils-ts';

const TEST_TENANT_ID = EXAMPLE_TENANT_IDENTIFIER;
const TEST_SECTOR = EXAMPLE_SECTOR;
const TEST_VAULT_ID = `${TEST_SECTOR}_${TEST_TENANT_ID}`;
const TEST_THREAD_ID = EXAMPLE_THREAD_IDENTIFIER_LICENSE_SEARCH;
const TEST_ISSUER = EXAMPLE_API_ORGANIZATION_DID;
const TEST_AUDIENCE = EXAMPLE_SERVICE_PUBLIC_DID;
const TEST_LICENSE_TYPE_ACTIVE = DeviceAppTypes.Mobile;
const TEST_LICENSE_TYPE_AVAILABLE = DeviceAppTypes.Web;
const TEST_LICENSE_USER_CLASS_ACTIVE = DeviceUserClasses.Employee;
const TEST_LICENSE_USER_CLASS_AVAILABLE = DeviceUserClasses.Individual;

/**
 * Canonical tenant-scoped GW route selector for license search operations.
 *
 * Keeping this shared shape explicit makes the test reflect the real endpoint
 * structure instead of a shortcut target string.
 */
const TEST_LICENSE_SEARCH_SELECTOR = Object.freeze({
  tenantId: TEST_TENANT_ID,
  jurisdiction: EXAMPLE_JURISDICTION,
  version: EXAMPLE_ROUTE_VERSION,
  sector: TEST_SECTOR,
  section: Section.entity,
  format: Format.Schema,
  resourceType: Resource.License,
  action: JobAction._search,
} as const);

/**
 * Builds one async job shaped exactly as the worker/router would send it to
 * `LicenseManager` for the canonical tenant-scoped `License/_search` action.
 *
 * Test intent:
 * - keep the search action explicit in the helper name
 * - avoid retyping the job envelope inline in each test
 * - make the business payload (`entry`) the only moving part per scenario
 */
function newJobSearchLicense(entry: Record<string, unknown>): JobRequest {
  return {
    id: EXAMPLE_JOB_IDENTIFIER_LICENSE_SEARCH,
    sequence: 0,
    status: JobStatus.DRAFT,
    createdAtTimestamp: Date.now(),
    tenantId: TEST_TENANT_ID,
    jurisdiction: EXAMPLE_JURISDICTION,
    apiVersion: EXAMPLE_ROUTE_VERSION,
    sector: TEST_SECTOR,
    section: TEST_LICENSE_SEARCH_SELECTOR.section,
    format: TEST_LICENSE_SEARCH_SELECTOR.format,
    resourceType: TEST_LICENSE_SEARCH_SELECTOR.resourceType,
    action: TEST_LICENSE_SEARCH_SELECTOR.action,
    content: {
      thid: TEST_THREAD_ID,
      iss: TEST_ISSUER,
      aud: TEST_AUDIENCE,
      type: EXAMPLE_CONTENT_TYPE_APPLICATION_JSON,
      body: {
        resourceType: EXAMPLE_BUNDLE_RESOURCE_TYPE,
        type: EXAMPLE_BUNDLE_TYPE_BATCH,
        entry: [entry],
      },
    } as any,
  };
}

/**
 * Returns one tiny tenant pool with:
 * - one active employee/professional seat
 * - one available individual seat
 *
 * These two rows are enough to demonstrate that the search layer can filter
 * both by lifecycle status and by controller-oriented claims such as
 * `email`, `role`, `category`, `type`, and `subjectId`.
 */
function newDocumentsLicenseSearchFixture(): ConfidentialStorageDoc[] {
  const activeLicense: DeviceLicense & Record<string, unknown> = {
    id: EXAMPLE_LICENSE_SEAT_UUID_ACTIVE,
    tenantId: TEST_TENANT_ID,
    orderId: EXAMPLE_LICENSE_OFFER_ID,
    userClass: TEST_LICENSE_USER_CLASS_ACTIVE,
    type: TEST_LICENSE_TYPE_ACTIVE,
    status: LicenseStatuses.Active,
    plan: EXAMPLE_LICENSE_RUNTIME_DEFAULTS.plan,
    renewalCycle: EXAMPLE_LICENSE_RUNTIME_DEFAULTS.renewalCycle,
    reactivationEnabled: EXAMPLE_LICENSE_RUNTIME_DEFAULTS.reactivationEnabled,
    exp: Math.floor(Date.now() / 1000) + 3600,
    subjectId: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
    issuedToEmail: EXAMPLE_EMAIL_CONTROLLER_ORG,
    issuedToRole: EXAMPLE_HEALTHCARE_ACTOR_ROLE_GENERALIST_MEDICAL_PRACTITIONER,
  };

  const availableLicense: DeviceLicense & Record<string, unknown> = {
    id: EXAMPLE_LICENSE_SEAT_UUID_AVAILABLE,
    tenantId: TEST_TENANT_ID,
    orderId: EXAMPLE_LICENSE_OFFER_ID,
    userClass: TEST_LICENSE_USER_CLASS_AVAILABLE,
    type: TEST_LICENSE_TYPE_AVAILABLE,
    status: LicenseStatuses.Available,
    plan: EXAMPLE_LICENSE_RUNTIME_DEFAULTS.plan,
    renewalCycle: EXAMPLE_LICENSE_RUNTIME_DEFAULTS.renewalCycle,
    reactivationEnabled: EXAMPLE_LICENSE_RUNTIME_DEFAULTS.reactivationEnabled,
    exp: Math.floor(Date.now() / 1000) + 3600,
    subjectId: EXAMPLE_LICENSE_SUBJECT_ID_AVAILABLE,
  };

  return [
    { id: activeLicense.id, status: activeLicense.status, sequence: 0, content: activeLicense },
    { id: availableLicense.id, status: availableLicense.status, sequence: 0, content: availableLicense },
  ] as ConfidentialStorageDoc[];
}

describe('LicenseManager (_search)', () => {
  let mockVaultRepository: MockProxy<IVaultRepository>;
  let manager: LicenseManager;

  beforeEach(() => {
    mockVaultRepository = mock<IVaultRepository>();
    manager = new LicenseManager(mockVaultRepository);
    mockVaultRepository.getContainersInSection.mockResolvedValue(newDocumentsLicenseSearchFixture() as any);
  });

  it('searches device licenses from one shared claims-first search entry', async () => {
    // High-level flow:
    // 1. frontend/BFF builds one semantic search draft
    // 2. common-utils maps it to the current claims-first entry
    // 3. GW returns normalized seat rows compatible with shared readers
    const entry = new LicenseListSearchEditor()
      .setSerialNumbers([EXAMPLE_LICENSE_SEAT_UUID_ACTIVE])
      .setUserClass(DeviceUserClasses.Employee)
      .setAppType(DeviceAppTypes.Mobile)
      .setEmail(EXAMPLE_EMAIL_CONTROLLER_ORG)
      .setRole(EXAMPLE_HEALTHCARE_ACTOR_ROLE_GENERALIST_MEDICAL_PRACTITIONER)
      .setStatus(LicenseStatuses.Active)
      .setSubjectId(EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE)
      .buildSearchEntry();

    const response = await manager.process(newJobSearchLicense(entry as unknown as Record<string, unknown>));

    const firstEntry = (response.body as any).data[0];
    expect(firstEntry.response.status).toBe('200');
    expect(firstEntry.resource.total).toBe(1);
    expect(firstEntry.resource.data).toEqual([
      expect.objectContaining({
        id: EXAMPLE_LICENSE_SEAT_UUID_ACTIVE,
        meta: expect.objectContaining({
          status: LicenseStatuses.Active,
          subjectId: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
          claims: expect.objectContaining({
            [ClaimsOfferSchemaorg.serialNumber]: EXAMPLE_LICENSE_SEAT_UUID_ACTIVE,
            [ClaimsIndividualProductSchemaorg.category]: LicenseCategories.Professional,
            [ClaimsIndividualProductSchemaorg.additionalType]: DeviceAppTypes.Mobile,
            [ClaimsPersonSchemaorg.email]: EXAMPLE_EMAIL_CONTROLLER_ORG,
            [ClaimsPersonSchemaorg.hasOccupationalRoleValue]: EXAMPLE_HEALTHCARE_ACTOR_ROLE_GENERALIST_MEDICAL_PRACTITIONER,
          }),
        }),
      }),
    ]);
    expect(mockVaultRepository.getContainersInSection).toHaveBeenCalledWith(
      TEST_VAULT_ID,
      getEnvSectionId('device-licenses'),
    );
  });

  it('searches device licenses from one FHIR Parameters wrapper', async () => {
    // Same business search, but through the canonical FHIR `_search` wrapper.
    const response = await manager.process(newJobSearchLicense({
      request: {
        method: 'POST',
        url: buildGwCoreTenantResourceActionPath(TEST_LICENSE_SEARCH_SELECTOR),
      },
      resource: buildFhirParametersResourceFromSearchParams({
        status: LicenseStatuses.Available,
        subjectId: EXAMPLE_LICENSE_SUBJECT_ID_AVAILABLE,
      }),
    }));

    const firstEntry = (response.body as any).data[0];
    expect(firstEntry.response.status).toBe('200');
    expect(firstEntry.resource.total).toBe(1);
    expect(firstEntry.resource.data[0]).toEqual(expect.objectContaining({
      id: EXAMPLE_LICENSE_SEAT_UUID_AVAILABLE,
      meta: expect.objectContaining({
        status: LicenseStatuses.Available,
        subjectId: EXAMPLE_LICENSE_SUBJECT_ID_AVAILABLE,
      }),
    }));
  });
});
