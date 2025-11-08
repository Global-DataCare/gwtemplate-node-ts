import * as admin from 'firebase-admin';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { RecordBase, VaultConfig } from '../../../models/resource-document';

const VAULT_METADATA_COLLECTION = '__vault_metadata';
const DEFAULT_SECTION = 'default';

/**
 * An implementation of the IVaultRepository interface that uses Google Firestore as the backend.
 * This implementation uses the Firebase Admin SDK and is configured via environment variables.
 */
export class FirestoreVaultRepository extends IVaultRepository {
  private readonly db: admin.firestore.Firestore;

  constructor() {
    super();
    if (admin.apps.length) {
      this.db = admin.firestore();
      return;
    }

    // When FIRESTORE_EMULATOR_HOST is set, the Admin SDK automatically
    // connects to the emulator, ignoring credentials.
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      admin.initializeApp({ projectId: 'firestore-vault-test-2' });
    } else {
      const projectId = process.env.FIRESTORE_PROJECT_ID;
      const credentialsVar = process.env.GOOGLE_APPLICATION_CREDENTIALS;

      if (!credentialsVar) {
        throw new Error('GOOGLE_APPLICATION_CREDENTIALS must be set.');
      }

      let credential;
      try {
        // Option 1: The variable is a JSON string (for Docker/serverless)
        credential = admin.credential.cert(JSON.parse(credentialsVar));
      } catch (e) {
        // Option 2: The variable is a file path (for local dev)
        credential = admin.credential.applicationDefault();
      }

      admin.initializeApp({ credential, projectId });
    }
    this.db = admin.firestore();
  }

  // --- Implemented Methods ---

  async createNewVault(vaultConfig: VaultConfig): Promise<boolean> {
    const vaultMetaDocRef = this.db.collection(VAULT_METADATA_COLLECTION).doc(vaultConfig.id);
    const docSnap = await vaultMetaDocRef.get();
    if (docSnap.exists) {
      return false;
    }
    await vaultMetaDocRef.set({ ...vaultConfig, createdAt: new Date() });
    return true;
  }

  async vaultExists(vaultId: string): Promise<boolean> {
    const vaultMetaDocRef = this.db.collection(VAULT_METADATA_COLLECTION).doc(vaultId);
    const docSnap = await vaultMetaDocRef.get();
    return docSnap.exists;
  }

  async put<T extends RecordBase>(vaultId: string, documents: T[], sectionId: string = DEFAULT_SECTION): Promise<boolean> {
    try {
      const batch = this.db.batch();
      const sectionCollectionRef = this.db.collection(vaultId).doc(sectionId).collection('documents');
      documents.forEach((document) => {
        const docRef = sectionCollectionRef.doc(document.id);
        batch.set(docRef, { ...document });
      });
      await batch.commit();
      return true;
    } catch (error) {
      console.error('Firestore put operation failed:', error);
      return false;
    }
  }

  async get<T extends RecordBase>(vaultId: string, docId: string, sectionId: string = DEFAULT_SECTION): Promise<T | undefined> {
    const docRef = this.db.collection(vaultId).doc(sectionId).collection('documents').doc(docId);
    const docSnap = await docRef.get();
    return docSnap.exists ? (docSnap.data() as T) : undefined;
  }

  async getContainersInSection<T extends RecordBase>(vaultId: string, sectionId: string): Promise<T[]> {
    const sectionCollectionRef = this.db.collection(vaultId).doc(sectionId).collection('documents');
    const querySnapshot = await sectionCollectionRef.get();
    return querySnapshot.docs.map((doc) => doc.data() as T);
  }

  async query<T extends RecordBase>(vaultId: string, q: any): Promise<T[]> {
    const sectionId = q.section || DEFAULT_SECTION;
    let queryChain: admin.firestore.Query = this.db.collection(vaultId).doc(sectionId).collection('documents');

    if (q.equals && q.equals['indexed.attributes']) {
      const attributeToFind = q.equals['indexed.attributes'];
      queryChain = queryChain.where('indexed.attributes', 'array-contains', attributeToFind);
    } else {
        throw new Error(`Query type not supported by FirestoreVaultRepository: ${JSON.stringify(q)}`);
    }

    const snapshot = await queryChain.get();
    return snapshot.docs.map((doc) => doc.data() as T);
  }

  // --- Stubbed Methods (Not Implemented) ---

  getVaultConfig(vaultId: string): Promise<VaultConfig | undefined> {
    throw new Error('Method not implemented.');
  }
  createNewSection(vaultId: string, sectionId: string): Promise<boolean> {
    throw new Error('Method not implemented.');
  }
  updateSection(vaultId: string, sectionId: string, containers?: any[] | undefined): Promise<boolean> {
    throw new Error('Method not implemented.');
  }
  getAllSections(vaultId: string): Promise<string[]> {
    throw new Error('Method not implemented.');
  }
  sectionExists(vaultId: string, sectionId: string): Promise<boolean> {
    throw new Error('Method not implemented.');
  }
  getContainersListInSection(vaultId: string, sectionId: string): Promise<string[]> {
    throw new Error('Method not implemented.');
  }
  getHistory(vaultId: string, containerId: string): Promise<any[]> {
    throw new Error('Method not implemented.');
  }
  delete(vaultId: string, containerId: string, sectionId?: string | undefined): Promise<boolean> {
    throw new Error('Method not implemented.');
  }
  purge(vaultId: string): Promise<boolean> {
    throw new Error('Method not implemented.');
  }
}
