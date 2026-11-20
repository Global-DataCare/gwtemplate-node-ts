import { createHash, randomUUID } from 'node:crypto';
import { publicOfferingResourceKey, readPublicOfferingCatalog, readPublicOfferingSubmission } from '../shared/public-offering-catalog';
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { isVerifiedBearerBoundToActorDid } from '../utils/authenticated-job-actor';
import { getTenantVaultId } from '../utils/tenant';
import { getTenantAuthorizationStatus } from '../utils/tenant-lifecycle';
import type { IJobProcessor } from './registry';

type CatalogTenant = Readonly<{
  didDocument?: { id?: string; controller?: string | readonly string[] };
  claims?: Readonly<Record<string, unknown>>;
}>;

type Dependencies = Readonly<{
  repository: Pick<IVaultRepository, 'get' | 'getContainersInSection' | 'listContainersInSection' | 'put'>;
  protection: Readonly<{
    protectConfidentialData(doc: ConfidentialStorageDoc, vaultId: string): Promise<ConfidentialStorageDoc>;
    unprotectConfidentialData<T>(doc: ConfidentialStorageDoc, vaultId: string): Promise<T>;
  }>;
  tenantManager: Readonly<{
    tenantExists(vaultId: string): Promise<boolean>;
    getTenantJurisdiction(vaultId: string): Promise<string | undefined>;
    getCollectionName(vaultId: string): Promise<string | undefined>;
    getTenant(vaultId: string): Promise<CatalogTenant | undefined>;
  }>;
}>;

const section = 'public-offering-catalog';
const snapshotId = 'current';
const legacyIndividualSection = 'public-offering-entries';
const individualSection = 'public-offering-listings';

/** The imported snapshot and each individual edit have independent protected write targets. */
export class PublicOfferingCatalogManager implements IJobProcessor {
  constructor(private readonly deps: Dependencies) {}

  async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const upsert = job.action === '_upsert';
    if (job.section !== 'organization' || job.format !== 'org.schema' || job.resourceType !== 'Catalog' || (!upsert && job.action !== '_publish')) {
      throw new ManagerError('Use the organization Schema.org catalogue publication route.', IssueType.NotSupported);
    }
    if (!job.content?.thid || !job.tenantId || job.tenantId === 'host' || !job.sector || !job.jurisdiction) {
      throw new ManagerError('Catalogue publication requires an organization tenant route.', IssueType.Required);
    }
    const sector = String(job.sector);
    const vaultId = getTenantVaultId(sector, String(job.tenantId));
    const collection = await this.deps.tenantManager.getCollectionName(vaultId);
    if (!collection || !await this.deps.tenantManager.tenantExists(vaultId)) {
      throw new ManagerError('Catalogue tenant was not found.', IssueType.NotFound);
    }
    const jurisdiction = await this.deps.tenantManager.getTenantJurisdiction(vaultId);
    if (!jurisdiction || jurisdiction.toUpperCase() !== String(job.jurisdiction).toUpperCase()) {
      throw new ManagerError('Catalogue tenant jurisdiction mismatch.', IssueType.Forbidden);
    }
    const tenant = await this.deps.tenantManager.getTenant(vaultId);
    const authorizationStatus = getTenantAuthorizationStatus(tenant);
    if (authorizationStatus !== 'active') {
      throw new ManagerError(`Tenant authorization is ${authorizationStatus}.`, IssueType.Forbidden);
    }
    const controller = tenant?.didDocument?.controller;
    const controllers = typeof controller === 'string' ? [controller] : controller ?? [];
    const actor = String(job.content.iss || '');
    const bearer = (job.content.meta as { bearer?: { jwt?: { payload?: Record<string, unknown> } } } | undefined)
      ?.bearer?.jwt?.payload;
    if (!String(job.contentType || '').startsWith('application/x-www-form-urlencoded')
      || !job.content.meta?.jws?.signature
      || !isVerifiedBearerBoundToActorDid(bearer, actor)) {
      throw new ManagerError('Catalogue publication requires a signed controller request.', IssueType.Forbidden);
    }
    if (!actor || !controllers.includes(actor)) throw new ManagerError('Only the organization controller may publish its catalogue.', IssueType.Forbidden);
    const publisherId = tenant?.didDocument?.id;
    const publisherName = tenant?.claims?.[ClaimsOrganizationSchemaorg.legalName] ?? tenant?.claims?.[ClaimsOrganizationSchemaorg.name];
    if (!publisherId || typeof publisherName !== 'string' || !publisherName.trim()) {
      throw new ManagerError('The admitted organization has no catalogue publisher identity.', IssueType.Invalid);
    }

    let offerings: ReturnType<typeof readPublicOfferingSubmission>;
    try {
      offerings = readPublicOfferingSubmission(job.content.body, { publisher: { id: publisherId, name: publisherName }, sector, demo: false });
    } catch {
      throw new ManagerError('Invalid catalogue submission for this publisher.', IssueType.Invalid);
    }
    if (upsert && offerings.length > 1) {
      const type = offerings[0]!.type;
      if (type === 'SoftwareApplication' || offerings.some(offering => offering.type !== type)) {
        throw new ManagerError('A reviewed batch must contain one offering type, Product or Service.', IssueType.Invalid);
      }
    }
    const batches = upsert
      ? offerings.map(offering => ({ id: createHash('sha256').update(publicOfferingResourceKey(offering)).digest('hex'), offerings: [offering] }))
      : [{ id: snapshotId, offerings }];
    const updated = new Date().toISOString();
    const protectedDocs: ConfidentialStorageDoc[] = [];
    for (const batch of batches) {
      protectedDocs.push(await this.deps.protection.protectConfidentialData({
        id: batch.id, status: 'active', sequence: 1, content: { claims: { offerings: batch.offerings } },
        audit: { updated } as ConfidentialStorageDoc['audit'],
      }, vaultId));
    }
    if (!await this.deps.repository.put(collection, protectedDocs, upsert ? individualSection : section)) {
      throw new ManagerError('The catalogue could not be persisted.', IssueType.NoStore);
    }
    return { jti: randomUUID(), thid: job.content.thid, type: 'org.schema.catalog-publication',
      iss: job.content.aud as string, aud: job.content.iss as string, body: { total: offerings.length } };
  }

  /** Checks publication metadata without decrypting or hydrating the offerings. */
  async hasPublications(vaultId: string): Promise<boolean> {
    const collection = await this.deps.tenantManager.getCollectionName(vaultId);
    if (!collection) return false;
    const [snapshots, legacyEntries, individualEntries] = await Promise.all([
      this.deps.repository.listContainersInSection<ConfidentialStorageDoc>(collection, section),
      this.deps.repository.listContainersInSection<ConfidentialStorageDoc>(collection, legacyIndividualSection),
      this.deps.repository.listContainersInSection<ConfidentialStorageDoc>(collection, individualSection),
    ]);
    return snapshots.some(doc => doc.id === snapshotId && doc.status === 'active')
      || legacyEntries.some(doc => doc.status === 'active')
      || individualEntries.some(doc => doc.status === 'active');
  }

  /** Reads the latest projection after the caller has resolved tenant discovery eligibility. */
  async read(vaultId: string) {
    const collection = await this.deps.tenantManager.getCollectionName(vaultId);
    if (!collection) return [];
    const [snapshot, legacyRecords, records] = await Promise.all([
      this.deps.repository.get<ConfidentialStorageDoc>(collection, snapshotId, section),
      this.deps.repository.getContainersInSection<ConfidentialStorageDoc>(collection, legacyIndividualSection),
      this.deps.repository.getContainersInSection<ConfidentialStorageDoc>(collection, individualSection),
    ]);
    const published = await Promise.all([snapshot, ...legacyRecords, ...records].flatMap(doc => doc?.status === 'active' ? [doc] : []).map(async doc => {
      const content = await this.deps.protection.unprotectConfidentialData<{ claims?: { offerings: unknown }; offerings?: unknown }>(doc, vaultId);
      return readPublicOfferingCatalog(content.claims?.offerings ?? content.offerings);
    }));
    return [...new Map(published.flat().map(offering => [publicOfferingResourceKey(offering), offering])).values()];
  }
}
