import { IServerConfig } from '../config';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';

let configInstance: IServerConfig;

export function resetServerConfig(): void {
  configInstance = undefined as unknown as IServerConfig;
}

export function determineApiBaseUrl(port: number, apiHostname: string): string {
  if (process.env.HOST_EXTERNAL_DOMAIN) {
    const domain = process.env.HOST_EXTERNAL_DOMAIN.replace(/^(https?:\/\/)/, '').replace(/\/$/, '');
    return `https://${domain}`;
  }
  if (process.env.HOST_DEPLOY_URL) {
    return process.env.HOST_DEPLOY_URL.replace(/\/$/, '');
  }
  const protocol = 'http';
  const publicHost = (apiHostname === '0.0.0.0' || apiHostname === '127.0.0.1')
    ? 'localhost'
    : apiHostname;
  return `${protocol}://${publicHost}:${port}`;
}

export function parseAndValidateSectors(csv: string | undefined): Sector[] {
  if (!csv) return [];
  const allSectors = Object.values(Sector) as string[];
  const requestedSectors = csv.split(',').map((s) => s.trim());
  for (const sector of requestedSectors) {
    if (sector === Sector.SYSTEM) {
      throw new Error(`Config Error: The '${Sector.SYSTEM}' sector is reserved and cannot be set in SECTORS_ALLOWED.`);
    }
    if (!allSectors.includes(sector)) {
      throw new Error(`Config Error: Invalid sector '${sector}'. Allowed: ${allSectors.join(', ')}`);
    }
  }
  return requestedSectors as Sector[];
}

function getHostEnv(key: string): string | undefined {
  const newKey = `HOST_${key}`;
  const legacyKey = `ORG_HOST_${key}`;
  return process.env[newKey] ?? process.env[legacyKey];
}

export function getConfig(): IServerConfig {
  if (!configInstance) {
    const port = parseInt(process.env.PORT || process.env.HOST_INTERNAL_PORT || '3000', 10);
    const isCloudRun = Boolean(process.env.K_SERVICE || process.env.K_REVISION || process.env.K_CONFIGURATION);
    const apiHostname = isCloudRun ? '0.0.0.0' : (process.env.HOST_INTERNAL_IP || 'localhost');
    const apiBaseUrl = determineApiBaseUrl(port, apiHostname);

    const localServiceRoles = (process.env.LOCAL_SERVICE_ROLE || 'HOST')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);

    configInstance = {
      nodeEnv: process.env.NODE_ENV || 'development',
      port: port,
      apiHostname,
      hostExternalDomain: process.env.HOST_EXTERNAL_DOMAIN || new URL(apiBaseUrl).host,
      apiBaseUrl,
      namespace: process.env.URN_NAMESPACE || 'antifraud',
      sectorsAllowed: parseAndValidateSectors(process.env.SECTORS_ALLOWED),
      allowedPaymentMethods: (process.env.ALLOWED_PAYMENT_METHODS || 'Stripe').split(','),
      dbProvider: process.env.DB_PROVIDER || 'mem',
      storageProvider: process.env.STORAGE_PROVIDER || 'mem',
      queueProvider: process.env.QUEUE_PROVIDER || 'mem',
      gcsBucketName: process.env.GCS_BUCKET_NAME,
      kekSecret: process.env.KEK_SECRET,
      host: {
        legalName: getHostEnv('LEGAL_NAME'),
        jurisdiction: getHostEnv('JURISDICTION'),
        idType: getHostEnv('ID_TYPE'),
        idValue: getHostEnv('ID_VALUE'),
        adminEmail: getHostEnv('ADMIN_EMAIL'),
        adminUid: getHostEnv('ADMIN_UID'),
        adminRole: getHostEnv('ADMIN_ROLE'),
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
      legacySignAlg: (process.env.LEGACY_SIGN_ALG === 'ES256' || process.env.LEGACY_SIGN_ALG === 'ES384')
        ? process.env.LEGACY_SIGN_ALG
        : 'ES384',
      legacyX509DerBase64: process.env.LEGACY_X509_DER_BASE64,
      legacyX509ChainBase64: process.env.LEGACY_X509_CHAIN_BASE64
        ? process.env.LEGACY_X509_CHAIN_BASE64.split(',').map((value) => value.trim()).filter(Boolean)
        : undefined,
      ica: {
        mode: (process.env.ICA_MODE === 'internal' || process.env.ICA_MODE === 'external')
          ? process.env.ICA_MODE
          : undefined,
        internalUrl: process.env.ICA_URL_INTERNAL,
        externalUrl: process.env.ICA_URL_EXTERNAL,
        tlsCaPem: process.env.ICA_TLS_CA_PEM,
      },
      ledger: {
        enabled: process.env.LEDGER_ENABLED ? process.env.LEDGER_ENABLED === 'true' : undefined,
        mspId: process.env.LEDGER_MSP_ID,
        channelName: process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT,
        chaincodeName: process.env.LEDGER_ORG_CHAINCODE,
        schemaUrl: process.env.GOVERNANCE_SCHEMA_URL,
      },
      localServiceRoles,
    };
  }
  return configInstance;
}

