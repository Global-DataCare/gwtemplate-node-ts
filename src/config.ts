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
  tasksCore?: {
    enabled: boolean;
    apiEnabled: boolean;
    workerEnabled: boolean;
    fhirEnabled: boolean;
    csvEnabled: boolean;
    defaultChannels: string[];
    autoCloseMinutes: number;
    confirmationRequiredDefault: boolean;
  };
  uhcTelephony?: {
    /** `twilio` uses real Twilio API; `mock` uses in-memory adapter (test/demo). */
    provider: 'twilio' | 'mock';
    smsEnabled: boolean;
    voiceEnabled: boolean;
    verifyEnabled: boolean;
    maxAttempts: number;
    retryIntervalMinutes: number;
    autoRescheduleOnNoResponse: boolean;
    escalationDelayMinutes: number;
    /** Enables ad-hoc reminder debug API endpoints (create/update/call/logs). Keep false in production. */
    reminderDebugApiEnabled: boolean;
    /** Emits reminder/voice events to server console when true. */
    reminderConsoleLogsEnabled: boolean;
    /** Enables the server-side reminder daemon that scans scheduled tasks and starts voice calls automatically. */
    reminderDaemonEnabled: boolean;
    /** Poll interval for reminder daemon in seconds. */
    reminderDaemonPollSeconds: number;
    /** Group reminder roots for the same subject when schedule difference is within this window. */
    groupWindowMinutes: number;
    /** Default locale for outbound messages (BCP-47, e.g. 'es', 'en', 'fr'). */
    defaultLocale: string;
    /** Default Twilio <Say> voice token (e.g. alice, Google.es-ES-Standard-A). */
    defaultTtsVoice?: string;
    twilio?: {
      accountSid?: string;
      authToken?: string;
      apiKeySid?: string;
      apiKeySecret?: string;
      messagingServiceSid?: string;
      voiceFromNumber?: string;
      voiceFlowSid?: string;
      verifyServiceSid?: string;
      webhookSignatureValidation: boolean;
    };
  };
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
