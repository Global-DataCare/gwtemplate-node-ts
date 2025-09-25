// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/config.ts

import { Sector } from "./models/sector";

/**
 * Centralized configuration module.
 * Reads environment variables and provides them to the application.
 */

// Helper function to build the base URL dynamically
function buildApiBaseUrl(): string {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const protocol = nodeEnv === 'production' ? 'https' : 'http';
  const hostname = process.env.API_HOSTNAME || 'localhost';
  const port = parseInt(process.env.PORT || '3000', 10);

  // Omit standard ports from the URL
  if ((protocol === 'http' && port === 80) || (protocol === 'https' && port === 443)) {
    return `${protocol}://${hostname}`;
  }

  return `${protocol}://${hostname}:${port}`;
}

function parseAndValidateSectors(csv: string | undefined): Sector[] {
  if (!csv) {
    return [];
  }
  const allSectors = Object.values(Sector) as string[];
  const requestedSectors = csv.split(',').map(item => item.trim());

  for (const sector of requestedSectors) {
    if (!allSectors.includes(sector)) {
      throw new Error(`Configuration Error: Invalid sector '${sector}' found in SECTORS_ALLOWED. Allowed values are: ${allSectors.join(', ')}`);
    }
  }
  return requestedSectors as Sector[];
}

/**
 * Defines the structure of the server's global configuration object.
 * This is read once at startup from environment variables.
 */
export interface IServerConfig {
  nodeEnv: string;
  port: number;
  apiHostname: string;
  apiBaseUrl: string;
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
const rawConfig: IServerConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    apiHostname: process.env.API_HOSTNAME || 'localhost',
    apiBaseUrl: buildApiBaseUrl(),
    sectorsAllowed: parseAndValidateSectors(process.env.SECTORS_ALLOWED),
    dbProvider: process.env.DB_PROVIDER || 'mem',
    queueProvider: process.env.QUEUE_PROVIDER || 'mem',
    kekSecret: process.env.KEK_SECRET,
    host: {
      legalName: process.env.ORG_HOST_LEGAL_NAME,
      jurisdiction: process.env.ORG_HOST_JURISDICTION,
      idType: process.env.ORG_HOST_ID_TYPE,
      idValue: process.env.ORG_HOST_ID_VALUE,
      adminEmail: process.env.ORG_HOST_ADMIN_EMAIL,
      adminUid: process.env.ORG_HOST_ADMIN_UID,
    },    
    mongo: {
        uri: process.env.MONGO_URI,
        dbName: process.env.MONGO_DB_NAME || 'default',
    },
    firebase: {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    googleClientId: process.env.GOOGLE_CLIENT_ID,
};

// --- Export a validated, correctly typed config object ---
export const config: typeof rawConfig = rawConfig as any;

