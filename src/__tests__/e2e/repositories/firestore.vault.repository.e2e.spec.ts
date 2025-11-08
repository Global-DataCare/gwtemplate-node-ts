import * as admin from 'firebase-admin';
import { ConfidentialStorageDoc } from '../../../models/confidential-storage';
import { FirestoreVaultRepository } from '../../../database/repositories/firestore/firestore.vault.repository';

// IMPORTANT: This E2E test is configured via the .env.test file.
// See TESTING-FIRESTORE.md for instructions.

const TEST_CONFIDENTIAL_DOC: ConfidentialStorageDoc = {
  id: 'e2e-doc-1',
  sequence: 0,
  indexed: {
    attributes: [
      { name: 'hmac_email', value: 'hmac_e2e@example.com', unique: true },
      { name: 'hmac_role', value: 'hmac_e2e_admin' },
    ],
  },
  jwe: { data: 'e2e-test' },
};

describe('FirestoreVaultRepository (E2E)', () => {
  let repository: FirestoreVaultRepository;
  const vaultId = `e2e-test-vault-${Date.now()}`; // Use a unique vault ID for each test run

  beforeAll(() => {
    // The repository's constructor will now initialize the admin SDK
    // using the environment variables loaded by `dotenv-cli`.
    repository = new FirestoreVaultRepository();
  });
  
  afterAll(async () => {
    const app = admin.apps[0];
    if (app) {
        const db = app.firestore();
        await db.collection('__vault_metadata').doc(vaultId).delete();
        await app.delete();
    }
  });

  // Since we use a unique vaultId for each run, we create it once.
  beforeEach(async () => {
    // Ensure the vault exists before each test. If it already exists, this will return false.
    await repository.createNewVault({ id: vaultId });
  }, 10000); // Increase timeout for real network calls

  describe('put and get operations', () => {
    it('should put a document and get it back by id', async () => {
      const sectionId = 'employees';
      await repository.put(vaultId, [TEST_CONFIDENTIAL_DOC], sectionId);
      const retrieved = await repository.get(vaultId, TEST_CONFIDENTIAL_DOC.id, sectionId);
      expect(retrieved).toEqual(TEST_CONFIDENTIAL_DOC);
    }, 10000);
  });

  describe('query operations', () => {
    it('should find a document by a unique indexed attribute', async () => {
      const sectionId = 'employees';
      await repository.put(vaultId, [TEST_CONFIDENTIAL_DOC], sectionId);
      
      const queryObj = {
        section: sectionId,
        equals: {
          'indexed.attributes': {
            name: 'hmac_email',
            value: 'hmac_e2e@example.com',
            unique: true
          },
        },
      };

      const results = await repository.query(vaultId, queryObj);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(TEST_CONFIDENTIAL_DOC);
    }, 10000);
  });
});
