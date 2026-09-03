// TDD contract: write this test red first; make it green only with the complete real behavior.
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import { buildExampleConfidentialJwe, buildExampleConfidentialStorageDoc } from 'gdc-common-utils-ts/utils/confidential-storage-test-data';
import { buildVitalSignObservationEntry, EXAMPLE_VITAL_SIGN_SYSTOLIC_BLOOD_PRESSURE_INPUT } from 'gdc-common-utils-ts/examples/vital-signs';
import { FirestoreVaultRepository } from '../../database/repositories/firestore/firestore.vault.repository';
import type { IConfidentialBlobStore } from '../../database/storage/IConfidentialBlobStore';
import { CONFIDENTIAL_JWE_INLINE_MAX_BYTES_ENV } from '../../database/repositories/vault/confidential-storage-persistence';
import { getEnvSectionId } from '../../utils/section-env';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';

// Teaching goal:
// Show how three blood-pressure readings captured on one day are stored as one
// atomic batch, then how that batch remains pending blockchain registration on
// the next day until the audit tx id is written.
//
// Step 1. Persist two day-level batch documents with three readings each.
// Step 2. Verify that the repository externalizes the encrypted payload and
//         keeps the batch pending while no audit tx id exists.
// Step 3. Simulate anchoring one batch by writing its audit tx id.
// Step 4. Confirm that the other batch remains pending.

const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const hasCredentialsFile = credentialsPath ? fs.existsSync(path.resolve(credentialsPath)) : false;
const hasFirestoreConfig = Boolean(
  process.env.FIRESTORE_EMULATOR_HOST || hasCredentialsFile || process.env.FIREBASE_PRIVATE_KEY,
);
const shouldRun = process.env.FIRESTORE_E2E === 'true' && hasFirestoreConfig;
const describeIfConfigured = shouldRun ? describe : describe.skip;

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

function isPendingBlockchainRegistration(doc?: ConfidentialStorageDoc): boolean {
  return Boolean(doc?.blob && !doc.audit?.txId);
}

function buildBloodPressureDayBatchDoc(dayLabel: string, dayDate: string): ConfidentialStorageDoc {
  const systolicValues = [120, 123, 118];
  const entries = systolicValues.map((value, index) =>
    buildVitalSignObservationEntry({
      ...EXAMPLE_VITAL_SIGN_SYSTOLIC_BLOOD_PRESSURE_INPUT,
      identifier: `urn:uuid:${dayLabel}-bp-${index + 1}`,
      effectiveDateTime: `${dayDate}T08:${30 + (index * 3)}:00Z`,
      valueQuantity: value,
    }),
  );

  return buildExampleConfidentialStorageDoc({
    id: `e2e-blood-pressure-${dayLabel}`,
    status: 'active',
    sequence: 0,
    audit: {
      created: `${dayDate}T09:00:00Z`,
    },
    content: {
      resourceType: ResourceTypesFhirR4.Bundle,
      type: 'collection',
      data: entries,
    },
    jwe: {
      ...buildExampleConfidentialJwe(),
      ciphertext: 'x'.repeat(1024),
    },
  });
}

describeIfConfigured('FirestoreVaultRepository blood-pressure day batches (E2E)', () => {
  let repository: FirestoreVaultRepository;
  const vaultId = `e2e-test-vault-${Date.now()}`;
  const sectionId = getEnvSectionId('observations');
  const day1Id = 'e2e-blood-pressure-day-1';
  const day2Id = 'e2e-blood-pressure-day-2';
  const hostCollectionName = 'host';

  beforeAll(() => {
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    repository = new FirestoreVaultRepository(admin.firestore(), hostCollectionName, new InMemoryConfidentialBlobStore());
  });

  beforeEach(async () => {
    const db = admin.firestore();
    await db.collection(hostCollectionName).doc(getEnvSectionId('tenants')).collection('documents').doc(vaultId).set({
      id: vaultId,
      registered: new Date().toISOString(),
    });
  }, 10000);

  afterAll(async () => {
    const db = admin.firestore();
    await db.collection(vaultId).doc(sectionId).collection('documents').doc(day1Id).delete().catch(() => undefined);
    await db.collection(vaultId).doc(sectionId).collection('documents').doc(day2Id).delete().catch(() => undefined);
    await db.collection(hostCollectionName).doc(getEnvSectionId('tenants')).collection('documents').doc(vaultId).delete().catch(() => undefined);
    const app = admin.apps[0];
    if (app) {
      await app.delete();
    }
  });

  it('keeps a 3-reading daily batch pending until its blockchain tx id is written', async () => {
    const previousInlineThreshold = process.env[CONFIDENTIAL_JWE_INLINE_MAX_BYTES_ENV];
    process.env[CONFIDENTIAL_JWE_INLINE_MAX_BYTES_ENV] = '64';

    try {
      const day1Batch = buildBloodPressureDayBatchDoc('day-1', '2026-07-06');
      const day2Batch = buildBloodPressureDayBatchDoc('day-2', '2026-07-07');

      await repository.put(vaultId, [day1Batch, day2Batch], sectionId);

      const day1Raw = await admin.firestore().collection(vaultId).doc(sectionId).collection('documents').doc(day1Id).get();
      const day2Raw = await admin.firestore().collection(vaultId).doc(sectionId).collection('documents').doc(day2Id).get();

      expect(day1Raw.exists).toBe(true);
      expect(day2Raw.exists).toBe(true);
      expect(day1Raw.data()?.jwe).toBeUndefined();
      expect(day2Raw.data()?.jwe).toBeUndefined();
      expect(day1Raw.data()?.blob).toBeDefined();
      expect(day2Raw.data()?.blob).toBeDefined();
      expect(isPendingBlockchainRegistration(day1Raw.data() as ConfidentialStorageDoc)).toBe(true);
      expect(isPendingBlockchainRegistration(day2Raw.data() as ConfidentialStorageDoc)).toBe(true);

      const hydratedDay1 = await repository.get<ConfidentialStorageDoc>(vaultId, day1Id, sectionId);
      expect(hydratedDay1?.content).toEqual(expect.objectContaining({
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'collection',
      }));
      expect(Array.isArray((hydratedDay1?.content as { data?: unknown[] } | undefined)?.data)).toBe(true);
      expect((hydratedDay1?.content as { data?: unknown[] } | undefined)?.data).toHaveLength(3);

      const anchoredDay1 = {
        ...day1Batch,
        sequence: day1Batch.sequence + 1,
        audit: {
          ...(day1Batch.audit || {}),
          txId: 'tx-e2e-blood-pressure-day-1',
          txTime: '2026-07-07T08:30:00Z',
        },
      };

      await repository.put(vaultId, [anchoredDay1], sectionId);

      const anchoredDay1Raw = await admin.firestore().collection(vaultId).doc(sectionId).collection('documents').doc(day1Id).get();
      expect((anchoredDay1Raw.data() as ConfidentialStorageDoc | undefined)?.audit?.txId).toBe('tx-e2e-blood-pressure-day-1');
      expect(isPendingBlockchainRegistration(anchoredDay1Raw.data() as ConfidentialStorageDoc)).toBe(false);

      const hydratedDay2 = await repository.get<ConfidentialStorageDoc>(vaultId, day2Id, sectionId);
      expect(isPendingBlockchainRegistration(hydratedDay2)).toBe(true);
    } finally {
      if (previousInlineThreshold === undefined) {
        delete process.env[CONFIDENTIAL_JWE_INLINE_MAX_BYTES_ENV];
      } else {
        process.env[CONFIDENTIAL_JWE_INLINE_MAX_BYTES_ENV] = previousInlineThreshold;
      }
    }
  }, 20000);
});