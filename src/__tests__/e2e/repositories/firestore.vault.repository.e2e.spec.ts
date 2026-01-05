import admin from 'firebase-admin';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
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
  const vaultId = `e2e-test-vault-${Date.now()}`;

  beforeAll(() => {
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    const db = admin.firestore();
    repository = new FirestoreVaultRepository(db, 'host');
  });
  
  afterAll(async () => {
    const db = admin.firestore();
    // Clean up the test document from the test vault itself
    await db.collection(vaultId).doc('employees').collection('documents').doc(TEST_CONFIDENTIAL_DOC.id).delete().catch(() => {});
    // Clean up the vault registration document from the host's collection
    await db.collection('host').doc('tenants').collection('documents').doc(vaultId).delete().catch(() => {});

    const app = admin.apps[0];
    if (app) {
        await app.delete();
    }
  });

  // Before each test, ensure a registration document for the vault exists in the 'host' collection.
  beforeEach(async () => {
    const db = admin.firestore();
    const vaultRegDoc = { id: vaultId, registered: new Date().toISOString() };
    await db.collection('host').doc('tenants').collection('documents').doc(vaultId).set(vaultRegDoc);
  }, 10000);

  describe('vaultExists', () => {
    it('should return true for an existing vault and false for a non-existing one', async () => {
      const exists = await repository.vaultExists(vaultId);
      expect(exists).toBe(true);
      const nonExistent = await repository.vaultExists('non-existent-vault');
      expect(nonExistent).toBe(false);
    }, 10000);
  });

  describe('put and get operations', () => {
    it('should put a document and get it back by id', async () => {
      const sectionId = 'employees';
      await repository.put(vaultId, [TEST_CONFIDENTIAL_DOC], sectionId);
      const retrieved = await repository.get(vaultId, TEST_CONFIDENTIAL_DOC.id, sectionId);
      expect(retrieved).toEqual(expect.objectContaining({ id: 'e2e-doc-1' }));
    }, 10000);
  });

  describe('query operations', () => {
    it('should find a document by a unique indexed attribute', async () => {
      const sectionId = 'employees';
      await repository.put(vaultId, [TEST_CONFIDENTIAL_DOC], sectionId);
      
      const queryObj = {
        section: sectionId,
        equals: { 'indexed.attributes': { name: 'hmac_email', value: 'hmac_e2e@example.com', unique: true } },
      };

      const results = await repository.query(vaultId, queryObj);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(expect.objectContaining({ id: 'e2e-doc-1' }));
    }, 10000);
  });
});
