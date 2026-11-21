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
import { canonicalize } from '../utils/json-canon';
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
const historicalStatus = 'historical';

type Offering = ReturnType<typeof readPublicOfferingCatalog>[number];
type OfferingReference = Pick<Offering, 'type' | 'id'>;
type CatalogContent = {
  offerings: readonly Offering[];
  versions?: Record<string, string>;
  withdrawn?: OfferingReference;
};
type CurrentOffering = { offering: Offering; versionId: string };

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function offeringContentHash(offering: Offering): string {
  return digest(canonicalize(offering));
}

function offeringVersionId(content: CatalogContent, offering: Offering): string {
  return content.versions?.[digest(publicOfferingResourceKey(offering))] ?? offeringContentHash(offering);
}

function readReference(body: unknown): OfferingReference {
  const data = (body as { data?: unknown } | undefined)?.data;
  const entry = (Array.isArray(data) && data.length === 1 ? data[0] : data) as Partial<OfferingReference> | undefined;
  if (!entry || (entry.type !== 'Product' && entry.type !== 'Service')
    || typeof entry.id !== 'string' || !entry.id || entry.id.length > 2000
    || entry.id.trim() !== entry.id || entry.id === '*' || Object.keys(entry).length !== 2) {
    throw new ManagerError('Specify one Product or Service by its exact type and ID.', IssueType.Invalid);
  }
  return { type: entry.type, id: entry.id };
}

/** The imported snapshot and each individual edit have independent protected write targets. */
export class PublicOfferingCatalogManager implements IJobProcessor {
  constructor(private readonly deps: Dependencies) {}

  async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const upsert = job.action === '_upsert';
    const history = job.action === '_history';
    const unpublish = job.action === '_unpublish';
    if (job.section !== 'organization' || job.format !== 'org.schema' || job.resourceType !== 'Catalog'
      || (!upsert && !unpublish && !history && job.action !== '_publish')) {
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

    if (history) {
      return this.receipt(job, 'org.schema.catalog-history', { versions: await this.readHistory(collection, vaultId, readReference(job.content.body)) });
    }
    if (unpublish) {
      const reference = readReference(job.content.body);
      const id = digest(publicOfferingResourceKey(reference));
      const current = await this.deps.repository.get<ConfidentialStorageDoc>(collection, id, individualSection);
      if (current?.status !== 'inactive') {
        const selected = (await this.readCurrent(collection, vaultId)).find(item => publicOfferingResourceKey(item.offering) === publicOfferingResourceKey(reference));
        if (!selected) throw new ManagerError('The published offering was not found.', IssueType.NotFound);
        // Keep the version being withdrawn, including when it was published before version tracking.
        await this.write(collection, vaultId, individualSection, [{
          id, offerings: [selected.offering], withdrawn: reference, versions: { [id]: selected.versionId },
        }]);
      }
      return this.receipt(job, 'org.schema.catalog-publication', { total: 1 });
    }
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
      ? offerings.map(offering => ({ id: digest(publicOfferingResourceKey(offering)), offerings: [offering] }))
      : [{ id: snapshotId, offerings }];
    await this.write(collection, vaultId, upsert ? individualSection : section, batches);
    return this.receipt(job, 'org.schema.catalog-publication', { total: offerings.length });
  }

  private async write(collection: string, vaultId: string, targetSection: string, batches: readonly (CatalogContent & { id: string })[]) {
    const updated = new Date().toISOString();
    const documents: ConfidentialStorageDoc[] = [];
    for (const batch of batches) {
      const { id, offerings, withdrawn } = batch;
      const previous = await this.deps.repository.get<ConfidentialStorageDoc>(collection, id, targetSection);
      let preceding: CatalogContent | undefined;
      if (previous?.status === 'active') {
        preceding = await this.readContent(previous, vaultId);
        if (!preceding.versions) {
          const baseline = digest(canonicalize({ id, offerings: preceding.offerings }));
          documents.push({ id: `history-${baseline}`, status: historicalStatus, sequence: 1, content: { claims: preceding }, audit: previous.audit });
        }
      }
      const oldOfferings = new Map(preceding?.offerings.map(offering => [publicOfferingResourceKey(offering), offering]));
      const versions = batch.versions ?? Object.fromEntries(offerings.map(offering => {
        const key = publicOfferingResourceKey(offering);
        const old = oldOfferings.get(key);
        const version = old && preceding && offeringContentHash(old) === offeringContentHash(offering)
          ? offeringVersionId(preceding, old) : randomUUID();
        return [digest(key), version];
      }));
      const content = { claims: { offerings, versions, ...(withdrawn ? { withdrawn } : {}) } };
      const audit = { updated } as ConfidentialStorageDoc['audit'];
      documents.push(
        { id: `history-${randomUUID()}`, status: historicalStatus, sequence: 1, content, audit },
        { id, status: withdrawn ? 'inactive' : 'active', sequence: 1, content, audit },
      );
    }
    const protectedDocs = await Promise.all(documents.map(doc => this.deps.protection.protectConfidentialData(doc, vaultId)));
    if (!await this.deps.repository.put(collection, protectedDocs, targetSection)) {
      throw new ManagerError('The catalogue could not be persisted.', IssueType.NoStore);
    }
  }

  private receipt(job: JobRequest, type: string, body: Record<string, unknown>): IDecodedDidcommPayload {
    return { jti: randomUUID(), thid: job.content!.thid, type,
      iss: job.content!.aud as string, aud: job.content!.iss as string, body };
  }

  private async readContent(doc: ConfidentialStorageDoc, vaultId: string): Promise<CatalogContent> {
    const content = await this.deps.protection.unprotectConfidentialData<CatalogContent & { claims?: CatalogContent }>(doc, vaultId);
    return content.claims ?? content;
  }

  private async readHistory(collection: string, vaultId: string, reference: OfferingReference) {
    const scopes = [section, legacyIndividualSection, individualSection];
    const sections = await Promise.all(scopes.map(scope => this.deps.repository.getContainersInSection<ConfidentialStorageDoc>(collection, scope)));
    const key = publicOfferingResourceKey(reference);
    const candidates = sections.flatMap((records, index) => records
      .filter(doc => doc.status === historicalStatus || doc.status === 'active')
      .map(doc => ({ doc, imported: scopes[index] === section })));
    const versions = await Promise.all(candidates.map(async ({ doc, imported }) => {
      const content = await this.readContent(doc, vaultId);
      if (doc.status === 'active' && content.versions) return undefined;
      const offering = readPublicOfferingCatalog(content.offerings).find(item => publicOfferingResourceKey(item) === key);
      if (!offering) return undefined;
      const status = content.withdrawn ? 'withdrawn' : imported ? 'imported' : 'published';
      return { versionId: offeringVersionId(content, offering), contentHash: offeringContentHash(offering), status,
        ...(doc.audit?.updated ? { recordedAt: doc.audit.updated } : {}), offering };
    }));
    return versions.flatMap(version => version ? [version] : []).sort((a, b) => (a.recordedAt ?? '').localeCompare(b.recordedAt ?? ''));
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
    if (individualEntries.some(doc => doc.status === 'active')) return true;
    const hasImportedListings = snapshots.some(doc => doc.id === snapshotId && doc.status === 'active')
      || legacyEntries.some(doc => doc.status === 'active');
    if (!hasImportedListings) return false;
    return !individualEntries.some(doc => doc.status === 'inactive') || (await this.read(vaultId)).length > 0;
  }

  /** Reads the latest projection after the caller has resolved tenant discovery eligibility. */
  async read(vaultId: string) {
    const collection = await this.deps.tenantManager.getCollectionName(vaultId);
    return collection ? (await this.readCurrent(collection, vaultId)).map(({ offering }) => offering) : [];
  }

  private async readCurrent(collection: string, vaultId: string): Promise<CurrentOffering[]> {
    const [snapshot, legacyRecords, records] = await Promise.all([
      this.deps.repository.get<ConfidentialStorageDoc>(collection, snapshotId, section),
      this.deps.repository.getContainersInSection<ConfidentialStorageDoc>(collection, legacyIndividualSection),
      this.deps.repository.listContainersInSection<ConfidentialStorageDoc>(collection, individualSection),
    ]);
    const current = await Promise.all(records.filter(doc => doc.status === 'active' || doc.status === 'inactive').map(doc =>
      this.deps.repository.get<ConfidentialStorageDoc>(collection, doc.id, individualSection)));
    const published = await Promise.all([snapshot, ...legacyRecords, ...current].flatMap(doc => doc?.status === 'active' ? [doc] : []).map(async doc => {
      const content = await this.readContent(doc, vaultId);
      return readPublicOfferingCatalog(content.offerings).map(offering => ({ offering, versionId: offeringVersionId(content, offering) }));
    }));
    const withdrawn = new Set(current.flatMap(doc => doc?.status === 'inactive' ? [doc.id] : []));
    return [...new Map(published.flat().map(item => [publicOfferingResourceKey(item.offering), item])).entries()]
      .filter(([key]) => !withdrawn.has(digest(key)))
      .map(([, item]) => item);
  }
}
