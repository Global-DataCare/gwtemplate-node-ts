// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { invokeExpress } from './helpers/invokeExpress';
import { startServer, resetServerConfig } from '../../server';
import { getTenantVaultId, generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { testTenant1TenantId } from '../data/organization.data';
import { FAMILY_MEMBER_RELATIONSHIP_MESSAGE } from '../data/example-payloads';
import { initializeTenantServicesConfig } from '../../utils/services';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { getEnvSectionId } from '../../utils/section-env';
import { configureAuthenticatedTestActor } from './helpers/authenticated-test-actor';
import {
  SearchResponseProfileEnvironment,
  SearchResponseProfiles,
} from '../../utils/didcomm-response';

/**
 * Numbered journey:
 * 1. Bootstrap one protected tenant with the published RelatedPerson services.
 * 2. Submit the shared RelatedPerson fixture through the public asynchronous API.
 * 3. Search with its explicit subject and poll the public response route.
 * 4. Prove the primary profile returns one resource per outer Bundle entry.
 *
 * Authorization invariant: both writes and reads use the authenticated actor.
 * Persistence invariant: search reads only the requested subject section and
 * returns the record previously committed through the real queue boundary.
 */
describe('RelatedPerson subject-scoped search API', () => {
  afterEach(() => {
    delete process.env[SearchResponseProfileEnvironment.Variable];
    resetServerConfig();
  });

  it('persists and reads one primary RelatedPerson search resource through the route boundary', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test', DB_PROVIDER: 'mem', STORAGE_PROVIDER: 'mem', QUEUE_PROVIDER: 'mem',
      ALLOWED_SECTORS: 'health-care', ORG_HOST_LEGAL_NAME: 'Gateway Host Services',
      ORG_HOST_JURISDICTION: 'ES', ORG_HOST_ID_TYPE: 'TAX', ORG_HOST_ID_VALUE: 'A0011223344',
      ORG_HOST_ADMIN_EMAIL: 'admin@host.com', ORG_HOST_ADMIN_UID: 'host-admin-001',
      ORG_HOST_ADMIN_ROLE: 'ISCO-08|1111', SECURITY_MODE: 'demo', JSON_LEGACY: 'true',
      [SearchResponseProfileEnvironment.Variable]: SearchResponseProfiles.PrimaryResource,
    });
    const authenticatedActor = await configureAuthenticatedTestActor();
    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
      const hostClaims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
        [ClaimsOrganizationSchemaorg.identifierType]: 'TAX',
        [ClaimsOrganizationSchemaorg.identifierValue]: 'A0011223344',
        [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
      };
      const tenantClaims = testPayloadCreateTenant1.body.data[0].resource.meta.claims as any;
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);
      await kmsService.provisionKeys(tenantVaultId);
      const protectedTenant = await kmsService.protectConfidentialData({
        id: tenantVaultId,
        sequence: 0,
        content: {
          claims: tenantClaims,
          didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
          didDocument: { id: 'did:web:api.example.org', '@context': 'https://www.w3.org/ns/did/v1' },
        },
      } as any, 'host');
      await vaultRepository.put(
        generateTenantCollectionNameFromClaims(hostClaims as any),
        [protectedTenant as any],
        getEnvSectionId('tenants'),
      );
      await tenantManager.getTenant(tenantVaultId);

      const fixture = structuredClone(FAMILY_MEMBER_RELATIONSHIP_MESSAGE) as any;
      const subject = String(fixture.body.entry[0].meta.claims['RelatedPerson.patient']);
      fixture.body.entry[0].resource.meta = { claims: fixture.body.entry[0].meta.claims };
      delete fixture.body.entry[0].meta;
      const route = `/${testTenant1TenantId}/cds-ES/v1/${Sector.HEALTH_CARE}/individual/org.hl7.fhir.api/RelatedPerson`;
      expect((await invokeExpress(app, {
        method: HttpRequestMethods.Post,
        url: `${route}/_batch`,
        headers: { 'content-type': 'application/json', authorization: authenticatedActor.authorizationHeader },
        body: fixture,
      })).status).toBe(202);
      await poll(app, `${route}/_batch-response`, fixture.thid);

      const searchThid = `${fixture.thid}-search`;
      expect((await invokeExpress(app, {
        method: HttpRequestMethods.Post,
        url: `${route}/_search`,
        headers: { 'content-type': 'application/json', authorization: authenticatedActor.authorizationHeader },
        body: {
          thid: searchThid,
          body: { resourceType: ResourceTypesFhirR4.Parameters, parameter: [{ name: 'patient', valueString: subject }] },
        },
      })).status).toBe(202);
      const result = await poll(app, `${route}/_search-response`, searchThid);
      const responseBody = result.body || result;

      expect(responseBody.total).toBe(1);
      expect(responseBody.data).toHaveLength(1);
      expect(responseBody.data[0].resource.resource).toMatchObject({ resourceType: ResourceTypesFhirR4.RelatedPerson });
      expect(responseBody.data[0].resource.data).toBeUndefined();
    } finally {
      queueAdapter.stop();
    }
  });
});

async function poll(app: any, url: string, thid: string): Promise<any> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await invokeExpress(app, {
      method: HttpRequestMethods.Post, url, headers: { 'content-type': 'application/json' }, body: { thid },
    });
    if (response.status === 200) return JSON.parse(response.text);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out polling ${url}`);
}
