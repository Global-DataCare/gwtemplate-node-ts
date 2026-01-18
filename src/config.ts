// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/config.ts

import { Sector } from "gdc-common-utils-ts/models/urlPath";

/**
 * Defines the shape of the application's configuration object.
 * This interface is exported so that different components can use it as a type
 * for dependency injection, without needing to know where the configuration comes from.
 */
export interface IServerConfig {
  nodeEnv: string;
  port: number;
  apiHostname: string;
  hostExternalDomain: string;
  apiBaseUrl: string;
  namespace: string;
  sectorsAllowed: Sector[];
  allowedPaymentMethods: string[];
  dbProvider: string;
  storageProvider: string;
  queueProvider: string;
  gcsBucketName?: string;
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
