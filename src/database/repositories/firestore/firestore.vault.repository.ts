import admin from 'firebase-admin';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { RecordBase, VaultConfig } from 'gdc-common-utils-ts/models/resource-document';

const DEFAULT_SECTION = 'default';

/**
 * An implementation of the IVaultRepository for Google Cloud Firestore.
 *
 * @architecture
 * `TenantsCacheManager`. However, it makes a single exception for the `vaultExists`
 * method, which is the designated entry point for this translation. `vaultExists`
 * checks for a tenant's registration document inside the host's physical collection.
 * All other methods (`get`, `put`, etc.) are "dumb" and operate directly on the
 * physical `collectionName` passed to them.
 *
 * The methods `createNewVault` and `vaultExists` are special cases to satisfy the
 * shared `IVaultRepository` interface.
 */
export class FirestoreVaultRepository extends IVaultRepository {
  private readonly db: admin.firestore.Firestore;
  private readonly hostCollectionName: string;

  constructor(db: admin.firestore.Firestore, hostCollectionName: string) {
    super();
    this.db = db;
    this.hostCollectionName = hostCollectionName;
  }

  /**
   * In the Firestore implementation, this is a no-op that returns true.
   * The actual creation of a tenant's registration record is handled by a `put`
   * operation orchestrated by the `HostingManager`. This method exists solely to
   * satisfy the interface contract established for the in-memory repository.
   */
  async createNewVault(vaultConfig: VaultConfig): Promise<boolean> {
    console.log(`[FirestoreVaultRepository] createNewVault for '${vaultConfig.id}' called (no-op).`);
    return Promise.resolve(true);
  }

  /**
   * Checks for the existence of a tenant's registration document within the host's vault.
   * This is the Firestore-specific implementation of checking for a logical vault's existence.
   * @param vaultId The logical vaultId of the tenant (e.g., 'health-care_acme').
   */
  async vaultExists(vaultId: string): Promise<boolean> {
    const doc = await this.get(this.hostCollectionName, vaultId, 'tenants');
    return doc !== undefined;
  }

  async put<T extends RecordBase>(collectionName: string, documents: T[], sectionId: string = DEFAULT_SECTION): Promise<boolean> {
    try {
      const batch = this.db.batch();
      // Firestore path: {collectionName}/{sectionId}/documents/{documentId}
      const sectionCollectionRef = this.db.collection(collectionName).doc(sectionId).collection('documents');
      documents.forEach((document) => {
        const docRef = sectionCollectionRef.doc(document.id);
        batch.set(docRef, { ...document });
      });
      await batch.commit();
      return true;
    } catch (error) {
      console.error(`[FirestoreVaultRepository] 'put' operation failed for collection '${collectionName}':`, error);
      return false;
    }
  }

  async get<T extends RecordBase>(collectionName: string, docId: string, sectionId: string = DEFAULT_SECTION): Promise<T | undefined> {
    const docRef = this.db.collection(collectionName).doc(sectionId).collection('documents').doc(docId);
    console.log(`[FirestoreVaultRepository DEBUG] GET path: ${docRef.path}`); // <-- DEBUG LOG
    const docSnap = await docRef.get();
    return docSnap.exists ? (docSnap.data() as T) : undefined;
  }

  async getContainersInSection<T extends RecordBase>(collectionName: string, sectionId: string): Promise<T[]> {
    const sectionCollectionRef = this.db.collection(collectionName).doc(sectionId).collection('documents');
    const querySnapshot = await sectionCollectionRef.get();
    return querySnapshot.docs.map((doc) => doc.data() as T);
  }

  async query<T extends RecordBase>(collectionName: string, q: any): Promise<T[]> {
    const sectionId = q.section || DEFAULT_SECTION;
    let queryChain: admin.firestore.Query = this.db.collection(collectionName).doc(sectionId).collection('documents');

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
  getVaultConfig(vaultId: string): Promise<VaultConfig | undefined> { throw new Error('Method not implemented.'); }
  createNewSection(collectionName: string, sectionId: string): Promise<boolean> { throw new Error('Method not implemented.'); }
  updateSection(collectionName: string, sectionId: string, containers?: any[] | undefined): Promise<boolean> { throw new Error('Method not implemented.'); }
  getAllSections(collectionName: string): Promise<string[]> { throw new Error('Method not implemented.'); }
  sectionExists(collectionName: string, sectionId: string): Promise<boolean> { throw new Error('Method not implemented.'); }
  getContainersListInSection(collectionName: string, sectionId: string): Promise<string[]> { throw new Error('Method not implemented.'); }
  getHistory(collectionName: string, containerId: string): Promise<any[]> { throw new Error('Method not implemented.'); }
  delete(collectionName: string, containerId: string, sectionId?: string | undefined): Promise<boolean> { throw new Error('Method not implemented.'); }
  purge(collectionName: string): Promise<boolean> { throw new Error('Method not implemented.'); }
}
