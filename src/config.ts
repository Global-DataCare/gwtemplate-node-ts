// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/config.ts

import { Sector } from "./models/path";

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
  network: string;
  sectorsAllowed: Sector[];
  dbProvider: string;
  queueProvider: string;
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
}