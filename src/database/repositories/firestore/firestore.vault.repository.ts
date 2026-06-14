import admin from 'firebase-admin';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { RecordBase, VaultConfig } from 'gdc-common-utils-ts/models/resource-document';
import { stripUndefinedDeep } from 'gdc-common-utils-ts';
import { getEnvSectionId } from '../../../utils/section-env';
import type { IConfidentialBlobStore } from '../../storage/IConfidentialBlobStore';
import {
  externalizeConfidentialStorageDocForPersistence,
  hydrateConfidentialStorageDocFromPersistence,
} from '../vault/confidential-storage-persistence';

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
  private readonly blobStore?: IConfidentialBlobStore;

  constructor(db: admin.firestore.Firestore, hostCollectionName: string, blobStore?: IConfidentialBlobStore) {
    super();
    this.db = db;
    this.hostCollectionName = hostCollectionName;
    this.blobStore = blobStore;
  }

  private sectionDocRef(collectionName: string, sectionId: string): admin.firestore.DocumentReference {
    return this.db.collection(collectionName).doc(sectionId);
  }

  private documentsCollectionRef(collectionName: string, sectionId: string): admin.firestore.CollectionReference {
    return this.sectionDocRef(collectionName, sectionId).collection('documents');
  }

  private async ensureSectionExists(collectionName: string, sectionId: string): Promise<void> {
    // Create/update the parent section doc so that:
    // - sections are discoverable via listDocuments()
    // - sectionExists() is meaningful
    await this.sectionDocRef(collectionName, sectionId).set(
      { id: sectionId, updatedAt: new Date().toISOString() },
      { merge: true },
    );
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
    const doc = await this.get(this.hostCollectionName, vaultId, getEnvSectionId('tenants'));
    return doc !== undefined;
  }

  async put<T extends RecordBase>(collectionName: string, documents: T[], sectionId: string = DEFAULT_SECTION): Promise<boolean> {
    try {
      await this.ensureSectionExists(collectionName, sectionId);
      const batch = this.db.batch();
      // Firestore path: {collectionName}/{sectionId}/documents/{documentId}
      const sectionCollectionRef = this.documentsCollectionRef(collectionName, sectionId);
      for (const document of documents) {
        const persistedDocument = await externalizeConfidentialStorageDocForPersistence(document, this.blobStore);
        const docRef = sectionCollectionRef.doc(document.id);
        batch.set(docRef, stripUndefinedDeep({ ...persistedDocument }));
      }
      await batch.commit();
      return true;
    } catch (error) {
      console.error(`[FirestoreVaultRepository] 'put' operation failed for collection '${collectionName}':`, error);
      return false;
    }
  }

  async get<T extends RecordBase>(collectionName: string, docId: string, sectionId: string = DEFAULT_SECTION): Promise<T | undefined> {
    const docRef = this.documentsCollectionRef(collectionName, sectionId).doc(docId);
    console.log(`[FirestoreVaultRepository DEBUG] GET path: ${docRef.path}`); // <-- DEBUG LOG
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return undefined;
    }
    return hydrateConfidentialStorageDocFromPersistence(docSnap.data() as T, this.blobStore);
  }

  async getContainersInSection<T extends RecordBase>(collectionName: string, sectionId: string): Promise<T[]> {
    const sectionCollectionRef = this.documentsCollectionRef(collectionName, sectionId);
    const querySnapshot = await sectionCollectionRef.get();
    return Promise.all(
      querySnapshot.docs.map((doc) =>
        hydrateConfidentialStorageDocFromPersistence(doc.data() as T, this.blobStore),
      ),
    );
  }

  async query<T extends RecordBase>(collectionName: string, q: any): Promise<T[]> {
    const sectionId = q.sectionId || q.section || DEFAULT_SECTION;
    const snapshot = await this.documentsCollectionRef(collectionName, sectionId).get();
    const docs = snapshot.docs.map((doc) => doc.data() as any);

    if (Array.isArray(q.where) && q.where.length > 0) {
      return Promise.all(docs.filter((doc) => {
        const attributes = Array.isArray(doc?.indexed?.attributes) ? doc.indexed.attributes : [];
        return q.where.every((condition: { name: string; value: string }) =>
          attributes.some((attr: { name?: string; value?: string }) =>
            attr?.name === condition.name && attr?.value === condition.value
          )
        );
      }).map((doc) => hydrateConfidentialStorageDocFromPersistence(doc as T, this.blobStore)));
    }

    if (q.equals && q.equals['indexed.attributes']) {
      const attributeToFind = q.equals['indexed.attributes'];
      return Promise.all(docs.filter((doc) => {
        const attributes = Array.isArray(doc?.indexed?.attributes) ? doc.indexed.attributes : [];
        return attributes.some((attr: unknown) => JSON.stringify(attr) === JSON.stringify(attributeToFind));
      }).map((doc) => hydrateConfidentialStorageDocFromPersistence(doc as T, this.blobStore)));
    }

    throw new Error(`Query type not supported by FirestoreVaultRepository: ${JSON.stringify(q)}`);
  }

  async getVaultConfig(vaultId: string): Promise<VaultConfig | undefined> {
    // Firestore BYOD variant can store vault configs in a well-known section inside the vault itself.
    // For now, return undefined unless explicitly stored by managers.
    return undefined;
  }

  async createNewSection(collectionName: string, sectionId: string): Promise<boolean> {
    try {
      await this.ensureSectionExists(collectionName, sectionId);
      return true;
    } catch (error) {
      console.error(`[FirestoreVaultRepository] createNewSection failed for '${collectionName}/${sectionId}':`, error);
      return false;
    }
  }

  async updateSection(collectionName: string, sectionId: string, containers: any[] = []): Promise<boolean> {
    // Note: this does not delete containers that are no longer present. It only upserts.
    try {
      await this.put(collectionName, containers, sectionId);
      return true;
    } catch (error) {
      console.error(`[FirestoreVaultRepository] updateSection failed for '${collectionName}/${sectionId}':`, error);
      return false;
    }
  }

  async getAllSections(collectionName: string): Promise<string[]> {
    const docs = await this.db.collection(collectionName).listDocuments();
    return docs.map((d) => d.id);
  }

  async sectionExists(collectionName: string, sectionId: string): Promise<boolean> {
    const snap = await this.sectionDocRef(collectionName, sectionId).get();
    return snap.exists;
  }

  async getContainersListInSection(collectionName: string, sectionId: string): Promise<string[]> {
    const docs = await this.documentsCollectionRef(collectionName, sectionId).listDocuments();
    return docs.map((d) => d.id);
  }

  async getHistory(collectionName: string, containerId: string): Promise<any[]> {
    // Firestore does not provide version history by default (unless we implement it explicitly).
    return [];
  }

  async delete(collectionName: string, containerId: string, sectionId: string = DEFAULT_SECTION): Promise<boolean> {
    try {
      await this.documentsCollectionRef(collectionName, sectionId).doc(containerId).delete();
      return true;
    } catch (error) {
      console.error(`[FirestoreVaultRepository] delete failed for '${collectionName}/${sectionId}/${containerId}':`, error);
      return false;
    }
  }

  async purge(collectionName: string): Promise<boolean> {
    try {
      const sectionRefs = await this.db.collection(collectionName).listDocuments();
      for (const sectionRef of sectionRefs) {
        const documentRefs = await sectionRef.collection('documents').listDocuments();
        await Promise.all(documentRefs.map((documentRef) => documentRef.delete()));
        await sectionRef.delete().catch(() => undefined);
      }
      return true;
    } catch (error) {
      console.error(`[FirestoreVaultRepository] purge failed for '${collectionName}':`, error);
      return false;
    }
  }
}
