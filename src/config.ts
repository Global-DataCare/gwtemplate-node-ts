// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/config.ts

import { Sector } from "gdc-common-utils-ts/models/urlPath";

/**
 * Defines the shape of the application's configuration object.
 * This interface is exported so that different components can use it as a type
 * for dependency injection, without needing to know where the configuration comes from.
 */
export interface IServerConfig {
  securityMode: 'strict' | 'compat' | 'demo';
  networkMode: 'test' | 'test-network' | 'network';
  fhirLegacy: boolean;
  jsonLegacy: boolean;
  didcommPlainEnabled: boolean;
  demoAllowInsecureBearer: boolean;
  nodeEnv: string;
  port: number;
  apiHostname: string;
  hostExternalDomain: string;
  apiBaseUrl: string;
  namespace: string;
  ica?: {
    mode?: 'internal' | 'external';
    internalUrl?: string;
    externalUrl?: string;
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
  gcsBucketName?: string;
  supabase?: {
    url?: string;
    serviceRoleKey?: string;
    storageBucket?: string;
    storagePublic?: boolean;
  };
  kekSecret?: string;
  host: {
    legalName?: string;
    jurisdiction?: string;
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
