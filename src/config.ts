// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/config.ts

import { Sector } from "gdc-common-utils-ts/models/urlPath";

export type TenantServiceRoutes = Readonly<Record<string, Readonly<Record<string, string>>>>;

/**
 * Defines the shape of the application's configuration object.
 * This interface is exported so that different components can use it as a type
 * for dependency injection, without needing to know where the configuration comes from.
 */
export interface IServerConfig {
  securityMode: 'strict' | 'compat' | 'demo';
  networkMode: 'test' | 'local-network' | 'test-network' | 'network';
  fhirLegacy: boolean;
  jsonLegacy: boolean;
  didcommPlainEnabled: boolean;
  didcommPlaintextLegacyMediaTypeEnabled?: boolean;
  demoAllowInsecureBearer: boolean;
  nodeEnv: string;
  port: number;
  maxHeaderSize: number;
  apiHostname: string;
  hostExternalDomain: string;
  apiBaseUrl: string;
  /**
   * Optional per-tenant DID service routing, keyed first by canonical tenantId
   * and then by GW service section (for example `entity` or `individual`). The
   * reserved `default` entry routes shared discovery/identity services and is
   * the fallback for sections without an explicit override.
   * It changes operational endpoints only; it never creates a second tenant.
   */
  tenantServiceRoutes?: TenantServiceRoutes;
  namespace: string;
  ica?: {
    mode?: 'internal' | 'external';
    internalUrl?: string;
    externalUrl?: string;
    jurisdiction?: string;
    didWeb?: string;
    tlsCaPem?: string;
  };
  ledger?: {
    enabled?: boolean;
    mspId?: string;
    channelName?: string;
    chaincodeName?: string;
    schemaUrl?: string;
  };
  sectorsAllowed: Sector[];
  allowedPaymentMethods: string[];
  dbProvider: string;
  storageProvider: string;
  queueProvider: string;
  postgres?: {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    ssl?: boolean;
    schema?: string;
    maxPoolSize?: number;
  };
  /**
   * Separate configuration block for the planned research/digital twin store.
   *
   * Key ideas:
   * - This is not the main operational tenant vault.
   * - `enabled=false` means "ignore all research-store wiring for now".
   * - `separateDb=true` means operators must provide dedicated
   *   `RESEARCH_STORE_POSTGRES_*` settings instead of implicitly reusing the
   *   main `POSTGRES_*` connection.
   *
   * The following fields are intentionally explicit because they are easy to
   * misunderstand:
   * - `indexPrefix`:
   *   Human-chosen prefix used by future research-store tables/indexes so they
   *   are easy to recognize and avoid collisions with other schemas or
   *   deployments. Example: `rtwin`.
   * - `defaultLocale`:
   *   Fallback locale for normalized text indexing when an incoming artifact
   *   does not declare one. This does not translate text; it only tells the
   *   indexer which locale to assume for tokenization/search defaults.
   *   Example: `es` or `en`.
   * - `textSearchMode`:
   *   Planned text search strategy for normalized human-readable claims.
   *   `postgres-simple` is the safer initial option. `postgres-tsvector`
   *   implies a more PostgreSQL-native full-text indexing strategy.
   * - `codeIndexMode`:
   *   Planned code-index extraction strategy. The initial supported value,
   *   `normalized-claims-v1`, means "extract deterministic code rows from the
   *   allowlisted canonical claims model", for example `SYSTEM|CODE` values.
   */
  researchStore?: {
    enabled: boolean;
    provider?: 'postgres' | 'supabase' | 'firestore';
    separateDb: boolean;
    indexPrefix?: string;
    defaultLocale?: string;
    textSearchMode?: 'postgres-simple' | 'postgres-tsvector';
    codeIndexMode?: 'normalized-claims-v1';
    postgres?: {
      host?: string;
      port?: number;
      database?: string;
      user?: string;
      password?: string;
      ssl?: boolean;
      schema?: string;
    };
  };
  gcsBucketName?: string;
  supabase?: {
    url?: string;
    serviceRoleKey?: string;
    storageBucket?: string;
    storagePublic?: boolean;
  };
  ipfs?: {
    apiUrl?: string;
    gatewayUrl?: string;
    mfsRoot?: string;
  };
  envelope?: {
    provider?: 'memory' | 'local' | 'gcp-kms' | 'hashicorp-transit';
  };
  kekSecret?: string;
  gcpKms?: {
    keyName?: string;
    runtimeKekCiphertext?: string;
    runtimeKekId?: string;
  };
  hashicorpTransit?: {
    baseUrl?: string;
    mountPath?: string;
    keyName?: string;
    token?: string;
    namespace?: string;
  };
  host: {
    legalName?: string;
    jurisdiction?: string;
    coverageScope?: string;
    idType?: string;
    idValue?: string;
    adminEmail?: string;
    adminUid?: string;
    adminRole?: string;
  };
  mongo: {
    uri?: string;
    dbName: string;
  };
  firebase: {
    projectId?: string;
    clientEmail?: string;
    privateKey?: string;
  };
  googleClientId?: string;
  legacySignAlg?: string;
  legacyX509DerBase64?: string;
  legacyX509ChainBase64?: string[];
  localServiceRoles?: string[];
}
