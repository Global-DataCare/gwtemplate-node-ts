import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { buildExampleConfidentialJwe, buildExampleConfidentialStorageDoc } from 'gdc-common-utils-ts';
import { PostgresVaultRepository } from '../../../database/repositories/postgres/postgres.vault.repository';
import { ensurePostgresVaultSchema } from '../../../database/repositories/postgres/postgres.schema';
import { getEnvSectionId } from '../../../utils/section-env';
import type { IConfidentialBlobStore } from '../../../database/storage/IConfidentialBlobStore';

const HOST_COLLECTION = 'host-system-eu_vat_esx0000000x_system';
const TENANT_VAULT_ID = 'health-care_acme';

class InMemoryConfidentialBlobStore implements IConfidentialBlobStore {
  readonly provider = 'mem';
  private readonly blobs = new Map<string, Uint8Array>();

  async put(dataBytes: Uint8Array, contentType: string) {
    const blobRef = `blob-${this.blobs.size + 1}`;
    this.blobs.set(blobRef, dataBytes);
    return { blobRef, locator: `mem://${blobRef}`, contentType };
  }

  async get(blobRef: string) {
    const dataBytes = this.blobs.get(blobRef);
    if (!dataBytes) {
      throw new Error(`Missing test blob '${blobRef}'.`);
    }
    return { dataBytes, contentType: 'application/jose+json' };
  }
}

function expectHydratedConfidentialDoc(actual: unknown, expectedInlineDoc: ReturnType<typeof buildExampleConfidentialStorageDoc>): void {
  expect(actual).toEqual(expect.objectContaining(expectedInlineDoc));
  expect((actual as { blob?: unknown }).blob).toMatchObject({
    provider: 'mem',
    contentType: 'application/jose+json',
  });
}

function createPool(): Pool {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'current_database',
    implementation: () => 'pg_mem',
  });
  const adapter = db.adapters.createPg();
  return new adapter.Pool();
}

describe('PostgresVaultRepository (Integration)', () => {
  let pool: Pool;
  let repository: PostgresVaultRepository;
  let blobStore: InMemoryConfidentialBlobStore;
  const testConfidentialDoc = buildExampleConfidentialStorageDoc();

  beforeEach(async () => {
    pool = createPool();
    await ensurePostgresVaultSchema(pool, 'vault_test');
    blobStore = new InMemoryConfidentialBlobStore();
    repository = new PostgresVaultRepository(pool, HOST_COLLECTION, 'vault_test', blobStore);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('puts a ConfidentialStorageDoc into a section and gets it back by id', async () => {
    const sectionId = getEnvSectionId('employees');

    await repository.put(TENANT_VAULT_ID, [testConfidentialDoc], sectionId);
    const retrievedDoc = await repository.get(TENANT_VAULT_ID, testConfidentialDoc.id, sectionId);

    expectHydratedConfidentialDoc(retrievedDoc, testConfidentialDoc);

    const rawStored = await pool.query(
      'SELECT payload_json FROM "vault_test"."vault_documents" WHERE collection_name = $1 AND section_id = $2 AND document_id = $3',
      [TENANT_VAULT_ID, sectionId, testConfidentialDoc.id],
    );
    expect(rawStored.rows[0].payload_json.jwe).toBeUndefined();
    expect(rawStored.rows[0].payload_json.blob).toMatchObject({
      provider: 'mem',
      contentType: 'application/jose+json',
    });
  });

  it('updates an existing document when put is called again with the same id', async () => {
    const updatedDoc = buildExampleConfidentialStorageDoc({
      sequence: 1,
      jwe: {
        ...buildExampleConfidentialJwe(),
        ciphertext: 'updated',
      },
    });

    await repository.put(TENANT_VAULT_ID, [testConfidentialDoc]);
    await repository.put(TENANT_VAULT_ID, [updatedDoc]);

    const retrievedDoc = await repository.get(TENANT_VAULT_ID, testConfidentialDoc.id);
    expectHydratedConfidentialDoc(retrievedDoc, updatedDoc);
  });

  it('finds a document by indexed attributes using the where query format', async () => {
    const sectionId = getEnvSectionId('employees');
    await repository.put(TENANT_VAULT_ID, [testConfidentialDoc], sectionId);

    const results = await repository.query(TENANT_VAULT_ID, {
      sectionId,
      where: [{ name: 'hmac_for_email', value: 'hmac_for_test@example.com' }],
    });

    expect(results).toHaveLength(1);
    expectHydratedConfidentialDoc(results[0], testConfidentialDoc);
  });

  it('finds a document by indexed attributes using the legacy equals query format', async () => {
    const sectionId = getEnvSectionId('employees');
    await repository.put(TENANT_VAULT_ID, [testConfidentialDoc], sectionId);

    const results = await repository.query(TENANT_VAULT_ID, {
      section: sectionId,
      equals: {
        'indexed.attributes': {
          name: 'hmac_for_email',
          value: 'hmac_for_test@example.com',
        },
      },
    });

    expect(results).toHaveLength(1);
    expectHydratedConfidentialDoc(results[0], testConfidentialDoc);
  });

  it('finds documents only when all query conditions match', async () => {
    const sectionId = getEnvSectionId('employees');
    const secondDoc = buildExampleConfidentialStorageDoc({
      id: 'doc-2',
      indexed: {
        attributes: [
          { name: 'hmac_for_role', value: 'hmac_for_admin' },
          { name: 'hmac_for_email', value: 'hmac_for_other@example.com', unique: true },
        ],
      },
    });
    await repository.put(TENANT_VAULT_ID, [testConfidentialDoc, secondDoc], sectionId);

    const results = await repository.query(TENANT_VAULT_ID, {
      sectionId,
      where: [
        { name: 'hmac_for_role', value: 'hmac_for_admin' },
        { name: 'hmac_for_email', value: 'hmac_for_test@example.com' },
      ],
    });

    expect(results).toHaveLength(1);
    expectHydratedConfidentialDoc(results[0], testConfidentialDoc);
  });

  it('marks a document as deleted and purge clears deleted rows physically', async () => {
    const sectionId = getEnvSectionId('employees');
    await repository.put(TENANT_VAULT_ID, [testConfidentialDoc], sectionId);

    const deleted = await repository.delete(TENANT_VAULT_ID, testConfidentialDoc.id, sectionId);
    const afterDelete = await repository.get(TENANT_VAULT_ID, testConfidentialDoc.id, sectionId);
    const listAfterDelete = await repository.getContainersInSection(TENANT_VAULT_ID, sectionId);

    expect(deleted).toBe(true);
    expect(afterDelete).toBeUndefined();
    expect(listAfterDelete).toHaveLength(0);

    const purged = await repository.purge(TENANT_VAULT_ID);
    expect(purged).toBe(true);

    const rawResult = await pool.query(
      'SELECT COUNT(*)::int AS count FROM "vault_test"."vault_documents" WHERE collection_name = $1',
      [TENANT_VAULT_ID],
    );
    expect(rawResult.rows[0].count).toBe(0);
  });

  it('resolves logical vault existence through the host tenants section', async () => {
    await repository.createNewVault({ id: HOST_COLLECTION });
    await repository.put(
      HOST_COLLECTION,
      [{ id: TENANT_VAULT_ID, tenant: 'acme' } as any],
      getEnvSectionId('tenants'),
    );

    await repository.put(TENANT_VAULT_ID, [testConfidentialDoc], getEnvSectionId('employees'));

    await expect(repository.vaultExists('host')).resolves.toBe(true);
    await expect(repository.vaultExists(TENANT_VAULT_ID)).resolves.toBe(true);
    await expect(repository.vaultExists('health-care_missing')).resolves.toBe(false);
  });
});
