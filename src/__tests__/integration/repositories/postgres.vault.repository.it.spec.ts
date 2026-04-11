import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { PostgresVaultRepository } from '../../../database/repositories/postgres/postgres.vault.repository';
import { ensurePostgresVaultSchema } from '../../../database/repositories/postgres/postgres.schema';
import { getEnvSectionId } from '../../../utils/section-env';

const HOST_COLLECTION = 'host-system-eu_vat_esx0000000x_system';
const TENANT_VAULT_ID = 'health-care_acme';

const TEST_CONFIDENTIAL_DOC: ConfidentialStorageDoc = {
  id: 'doc-1',
  status: 'active',
  sequence: 0,
  indexed: {
    attributes: [
      {
        name: 'hmac_for_email',
        value: 'hmac_for_test@example.com',
        unique: true,
      },
      {
        name: 'hmac_for_role',
        value: 'hmac_for_admin',
      },
    ],
  },
  jwe: {
    protected: '...',
    recipients: [],
    iv: '...',
    ciphertext: '...',
    tag: '...',
  },
};

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

  beforeEach(async () => {
    pool = createPool();
    await ensurePostgresVaultSchema(pool, 'vault_test');
    repository = new PostgresVaultRepository(pool, HOST_COLLECTION, 'vault_test');
  });

  afterEach(async () => {
    await pool.end();
  });

  it('puts a ConfidentialStorageDoc into a section and gets it back by id', async () => {
    const sectionId = getEnvSectionId('employees');

    await repository.put(TENANT_VAULT_ID, [TEST_CONFIDENTIAL_DOC], sectionId);
    const retrievedDoc = await repository.get(TENANT_VAULT_ID, TEST_CONFIDENTIAL_DOC.id, sectionId);

    expect(retrievedDoc).toEqual(TEST_CONFIDENTIAL_DOC);
  });

  it('updates an existing document when put is called again with the same id', async () => {
    const updatedDoc: ConfidentialStorageDoc = {
      ...TEST_CONFIDENTIAL_DOC,
      sequence: 1,
      jwe: {
        protected: 'updated',
        recipients: [],
        iv: 'updated',
        ciphertext: 'updated',
        tag: 'updated',
      },
    };

    await repository.put(TENANT_VAULT_ID, [TEST_CONFIDENTIAL_DOC]);
    await repository.put(TENANT_VAULT_ID, [updatedDoc]);

    const retrievedDoc = await repository.get(TENANT_VAULT_ID, TEST_CONFIDENTIAL_DOC.id);
    expect(retrievedDoc).toEqual(updatedDoc);
  });

  it('finds a document by indexed attributes using the where query format', async () => {
    const sectionId = getEnvSectionId('employees');
    await repository.put(TENANT_VAULT_ID, [TEST_CONFIDENTIAL_DOC], sectionId);

    const results = await repository.query(TENANT_VAULT_ID, {
      sectionId,
      where: [{ name: 'hmac_for_email', value: 'hmac_for_test@example.com' }],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(TEST_CONFIDENTIAL_DOC);
  });

  it('finds a document by indexed attributes using the legacy equals query format', async () => {
    const sectionId = getEnvSectionId('employees');
    await repository.put(TENANT_VAULT_ID, [TEST_CONFIDENTIAL_DOC], sectionId);

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
    expect(results[0]).toEqual(TEST_CONFIDENTIAL_DOC);
  });

  it('finds documents only when all query conditions match', async () => {
    const sectionId = getEnvSectionId('employees');
    const secondDoc: ConfidentialStorageDoc = {
      ...TEST_CONFIDENTIAL_DOC,
      id: 'doc-2',
      indexed: {
        attributes: [
          { name: 'hmac_for_role', value: 'hmac_for_admin' },
          { name: 'hmac_for_email', value: 'hmac_for_other@example.com', unique: true },
        ],
      },
    };
    await repository.put(TENANT_VAULT_ID, [TEST_CONFIDENTIAL_DOC, secondDoc], sectionId);

    const results = await repository.query(TENANT_VAULT_ID, {
      sectionId,
      where: [
        { name: 'hmac_for_role', value: 'hmac_for_admin' },
        { name: 'hmac_for_email', value: 'hmac_for_test@example.com' },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(TEST_CONFIDENTIAL_DOC);
  });

  it('marks a document as deleted and purge clears deleted rows physically', async () => {
    const sectionId = getEnvSectionId('employees');
    await repository.put(TENANT_VAULT_ID, [TEST_CONFIDENTIAL_DOC], sectionId);

    const deleted = await repository.delete(TENANT_VAULT_ID, TEST_CONFIDENTIAL_DOC.id, sectionId);
    const afterDelete = await repository.get(TENANT_VAULT_ID, TEST_CONFIDENTIAL_DOC.id, sectionId);
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

    await repository.put(TENANT_VAULT_ID, [TEST_CONFIDENTIAL_DOC], getEnvSectionId('employees'));

    await expect(repository.vaultExists('host')).resolves.toBe(true);
    await expect(repository.vaultExists(TENANT_VAULT_ID)).resolves.toBe(true);
    await expect(repository.vaultExists('health-care_missing')).resolves.toBe(false);
  });
});