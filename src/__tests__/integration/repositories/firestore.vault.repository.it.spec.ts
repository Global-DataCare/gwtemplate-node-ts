import { RulesTestEnvironment, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { ConfidentialStorageDoc } from '../../../models/confidential-storage';
import { FirestoreVaultRepository } from '../../../database/repositories/firestore/firestore.vault.repository';

// A realistic test document that simulates a document with HMAC'd indexed attributes.
const TEST_CONFIDENTIAL_DOC: ConfidentialStorageDoc = {
  id: 'doc-1',
  sequence: 0,
  indexed: {
    attributes: [
      {
        name: 'hmac_for_email', // Represents HMAC("email")
        value: 'hmac_for_test@example.com', // Represents HMAC("test@example.com")
        unique: true,
      },
      {
        name: 'hmac_for_role', // Represents HMAC("role")
        value: 'hmac_for_admin', // Represents HMAC("admin")
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

describe('FirestoreVaultRepository (Integration)', () => {
  let repository: FirestoreVaultRepository;
  let testEnv: RulesTestEnvironment;
  const vaultId = 'my-confidential-vault';

  beforeAll(async () => {
    // Set the emulator host, which the FirestoreVaultRepository constructor will pick up.
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    testEnv = await initializeTestEnvironment({
      projectId: 'firestore-vault-test-2',
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    repository = new FirestoreVaultRepository();
    await repository.createNewVault({ id: vaultId });
  });

  afterAll(async () => {
    await testEnv.cleanup();
    // Unset the emulator host to avoid affecting other tests
    delete process.env.FIRESTORE_EMULATOR_HOST;
  });

  describe('put and get operations', () => {
    it('should put a ConfidentialStorageDoc into a specific section and get it back by id', async () => {
      // Arrange
      const sectionId = 'employees';

      // Act
      await repository.put(vaultId, [TEST_CONFIDENTIAL_DOC], sectionId);
      const retrievedDoc = await repository.get(vaultId, TEST_CONFIDENTIAL_DOC.id, sectionId);

      // Assert
      expect(retrievedDoc).toBeDefined();
      expect(retrievedDoc).toEqual(TEST_CONFIDENTIAL_DOC);
    });

    it('should update an existing document when put is called again with the same id', async () => {
        // Arrange
        const updatedDoc: ConfidentialStorageDoc = {
            ...TEST_CONFIDENTIAL_DOC,
            sequence: 1,
            jwe: { updated: 'true' }
        };
        await repository.put(vaultId, [TEST_CONFIDENTIAL_DOC]); // Put initial version

        // Act
        await repository.put(vaultId, [updatedDoc]);
        const retrievedDoc = await repository.get(vaultId, TEST_CONFIDENTIAL_DOC.id);

        // Assert
        expect(retrievedDoc).toEqual(updatedDoc);
    });
  });

  describe('query operations', () => {
    it('should find a document by a unique indexed attribute using the query method', async () => {
      // Arrange
      const sectionId = 'employees';
      await repository.put(vaultId, [TEST_CONFIDENTIAL_DOC], sectionId);
      const queryObj = {
        section: sectionId,
        equals: {
          'indexed.attributes': {
            name: 'hmac_for_email',
            value: 'hmac_for_test@example.com',
            unique: true,
          },
        },
      };

      // Act
      const results = await repository.query(vaultId, queryObj);

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(TEST_CONFIDENTIAL_DOC);
    });

    it('should return an empty array if no document matches the query', async () => {
      // Arrange
      const sectionId = 'employees';
      await repository.put(vaultId, [TEST_CONFIDENTIAL_DOC], sectionId);
      const queryObj = {
        section: sectionId,
        equals: {
          'indexed.attributes': {
            name: 'hmac_for_email',
            value: 'wrong_value',
          },
        },
      };
      
      // Act
      const results = await repository.query(vaultId, queryObj);

      // Assert
      expect(results).toHaveLength(0);
    });

    it('should find multiple documents by a non-unique indexed attribute using the query method', async () => {
      // Arrange
      const sectionId = 'employees';
      const anotherAdminDoc: ConfidentialStorageDoc = {
        ...TEST_CONFIDENTIAL_DOC,
        id: 'doc-2',
        indexed: {
          attributes: [
            { name: 'hmac_for_role', value: 'hmac_for_admin' }, // Same role
            { name: 'hmac_for_email', value: 'hmac_for_another@example.com', unique: true }
          ]
        }
      };
      await repository.put(vaultId, [TEST_CONFIDENTIAL_DOC, anotherAdminDoc], sectionId);

      const queryObj = {
        section: sectionId,
        equals: {
          'indexed.attributes': {
            name: 'hmac_for_role',
            value: 'hmac_for_admin',
          },
        },
      };

      // Act
      const results = await repository.query(vaultId, queryObj);

      // Assert
      expect(results).toHaveLength(2);
      expect(results).toEqual(expect.arrayContaining([TEST_CONFIDENTIAL_DOC, anotherAdminDoc]));
    });
  });
});
