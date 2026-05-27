import admin from 'firebase-admin';
import type { IServerConfig } from '../config';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { FirestoreVaultRepository } from '../database/repositories/firestore/firestore.vault.repository';
import { createPostgresPool } from '../database/repositories/postgres/postgres.client';
import { ensurePostgresVaultSchema } from '../database/repositories/postgres/postgres.schema';
import { PostgresVaultRepository } from '../database/repositories/postgres/postgres.vault.repository';
import { SupabaseStorageAdapter } from '../database/storage/supabase.storage.adapter';
import { VaultMemRepository } from '../database/repositories/vault/vault.mem.repository';
import type { IStorageAdapter } from '../database/storage/IStorageAdapter';
import { GcsStorageAdapter } from '../database/storage/gcs.storage.adapter';
import { StorageMemAdapter } from '../database/storage/mem.storage.adapter';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { AdapterCryptoSdkNode } from '../gdc-backend-utils-node/adapters/node/crypto';
import type { ILogger } from '../loggers/ILogger';
import { ConsoleLogger } from '../loggers/ConsoleLogger';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { KmsService } from '../services/KmsService';
import { DemoKmsService } from '../services/DemoKmsService';
import { TenantsCacheManager } from '../managers/TenantsCacheManager';

export async function buildInfrastructure(options: {
  config: IServerConfig;
  hostCollectionName: string;
}): Promise<{
  vaultRepository: IVaultRepository;
  storageAdapter: IStorageAdapter;
  cryptographyService: CryptographyService;
  logger: ILogger;
  tenantManager: TenantsCacheManager;
  kmsService: IKmsService;
}> {
  const { config, hostCollectionName } = options;

  let vaultRepository: IVaultRepository;
  if (config.dbProvider === 'firestore') {
    const db = admin.firestore();
    vaultRepository = new FirestoreVaultRepository(db, hostCollectionName);
    console.log('[GW-API] Using Firestore Vault Repository.');
  } else if (config.dbProvider === 'postgres') {
    const pool = createPostgresPool(config.postgres);
    await ensurePostgresVaultSchema(pool, config.postgres?.schema);
    vaultRepository = new PostgresVaultRepository(pool, hostCollectionName, config.postgres?.schema);
    console.log('[GW-API] Using PostgreSQL Vault Repository.');
  } else {
    vaultRepository = new VaultMemRepository();
    (vaultRepository as VaultMemRepository).clear();
    console.log('[GW-API] Using In-Memory Vault Repository (cleared).');
  }

  let storageAdapter: IStorageAdapter;
  if (config.storageProvider === 'gcs') {
    if (!config.gcsBucketName) {
      throw new Error("STORAGE_PROVIDER is 'gcs', but GCS_BUCKET_NAME is not configured.");
    }
    storageAdapter = new GcsStorageAdapter(config.gcsBucketName);
    console.log(`[GW-API] Using GCS Storage Adapter with bucket: ${config.gcsBucketName}`);
  } else if (config.storageProvider === 'supabase') {
    if (!config.supabase?.url) {
      throw new Error("STORAGE_PROVIDER is 'supabase', but SUPABASE_URL is not configured.");
    }
    if (!config.supabase?.serviceRoleKey) {
      throw new Error("STORAGE_PROVIDER is 'supabase', but SUPABASE_SERVICE_ROLE_KEY is not configured.");
    }
    if (!config.supabase?.storageBucket) {
      throw new Error("STORAGE_PROVIDER is 'supabase', but SUPABASE_STORAGE_BUCKET is not configured.");
    }
    storageAdapter = new SupabaseStorageAdapter({
      url: config.supabase.url,
      serviceRoleKey: config.supabase.serviceRoleKey,
      bucketName: config.supabase.storageBucket,
      publicBucket: config.supabase.storagePublic !== false,
    });
    console.log(`[GW-API] Using Supabase Storage Adapter with bucket: ${config.supabase.storageBucket}`);
  } else {
    storageAdapter = new StorageMemAdapter();
    console.log('[GW-API] Using In-Memory Storage Adapter.');
  }

  const cryptographyService = new CryptographyService(new AdapterCryptoSdkNode());
  const logger: ILogger = new ConsoleLogger();

  let kmsService: IKmsService;
  const tenantManager = new TenantsCacheManager(vaultRepository, () => kmsService, hostCollectionName);
  if (config.nodeEnv === 'demo') {
    const realKmsService = new KmsService(cryptographyService, tenantManager);
    kmsService = new DemoKmsService(realKmsService);
    console.log('[GW-API] Using DemoKmsService (with real key generation).');
  } else {
    kmsService = new KmsService(cryptographyService, tenantManager);
    console.log('[GW-API] Using KmsService.');
  }
  await kmsService.init();

  return { vaultRepository, storageAdapter, cryptographyService, logger, tenantManager, kmsService };
}
