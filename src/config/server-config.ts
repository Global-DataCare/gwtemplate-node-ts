import { IServerConfig } from '../config';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';

let configInstance: IServerConfig;

const MAIN_SECTORS = ['animal', 'health'] as const;
const SUBSECTORS = ['research', 'care', 'index', 'tech'] as const;

export type NetworkMode = 'test' | 'test-network' | 'network';

type MainSector = typeof MAIN_SECTORS[number];
type Subsector = typeof SUBSECTORS[number];

const DEFAULT_MAIN_SECTOR: MainSector = 'health';
const DEFAULT_SUBSECTORS: Subsector[] = ['research', 'care', 'index'];

function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'enabled') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'disabled') return false;
  return fallback;
}

export function parseSecurityMode(value: string | undefined): 'strict' | 'compat' | 'demo' {
  const normalized = String(value || 'strict').trim().toLowerCase();
  if (normalized === 'strict' || normalized === 'compat' || normalized === 'demo') {
    return normalized;
  }
  throw new Error("Config Error: Invalid SECURITY_MODE. Allowed: strict, compat, demo");
}

function mapNodeEnvToNetworkMode(nodeEnv: string | undefined): NetworkMode {
  const normalized = String(nodeEnv || '').trim().toLowerCase();
  if (normalized === 'production') return 'network';
  if (normalized === 'development' || normalized === 'staging') return 'test-network';
  return 'test';
}

export function parseNetworkMode(value: string | undefined, nodeEnv?: string): NetworkMode {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return mapNodeEnvToNetworkMode(nodeEnv);
  if (normalized === 'test' || normalized === 'test-network' || normalized === 'network') {
    return normalized;
  }
  throw new Error("Config Error: Invalid NETWORK_MODE. Allowed: test, test-network, network");
}

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
  const legacySectors = new Set(Object.values(Sector) as string[]);
  const requestedSectors = csv.split(',').map((s) => s.trim());
  const syntheticSectorPattern = /^(animal|health)-(research|care|index|tech)$/;
  for (const sector of requestedSectors) {
    if (sector === Sector.SYSTEM) {
      throw new Error(`Config Error: The '${Sector.SYSTEM}' sector is reserved and cannot be set in SECTORS_ALLOWED.`);
    }
    if (!legacySectors.has(sector) && !syntheticSectorPattern.test(sector)) {
      throw new Error(
          `Config Error: Invalid sector '${sector}'. Allowed legacy sectors (${Array.from(legacySectors).join(', ')}) ` +
          "or synthetic sectors '<animal|health>-<research|care|index|tech>'."
      );
    }
  }
  return requestedSectors as Sector[];
}

export function parseAndValidateMainSector(value: string | undefined): MainSector {
  const normalized = String(value || DEFAULT_MAIN_SECTOR).trim().toLowerCase();
  if (!MAIN_SECTORS.includes(normalized as MainSector)) {
    throw new Error(
      `Config Error: Invalid MAINSECTOR '${value}'. Allowed: ${MAIN_SECTORS.join(', ')}`
    );
  }
  return normalized as MainSector;
}

export function parseAndValidateSubsectors(csv: string | undefined): Subsector[] {
  const values = String(csv || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (values.length === 0) {
    return [...DEFAULT_SUBSECTORS];
  }

  const deduped: Subsector[] = [];
  for (const value of values) {
    if (!SUBSECTORS.includes(value as Subsector)) {
      throw new Error(
        `Config Error: Invalid SUBSECTORSALLOWED value '${value}'. Allowed: ${SUBSECTORS.join(', ')}`
      );
    }
    const typed = value as Subsector;
    if (!deduped.includes(typed)) {
      deduped.push(typed);
    }
  }
  return deduped;
}

export function buildSectorsFromMainAndSubsectors(main: MainSector, subsectors: Subsector[]): Sector[] {
  return subsectors.map((sub) => `${main}-${sub}` as Sector);
}

export function resolveAllowedSectorsFromEnv(env: NodeJS.ProcessEnv): Sector[] {
  const legacyCsv = String(env.SECTORS_ALLOWED || '').trim();
  if (legacyCsv) {
    console.warn('[Config] SECTORS_ALLOWED is deprecated. Use MAINSECTOR + SUBSECTORSALLOWED.');
    return parseAndValidateSectors(legacyCsv);
  }

  const main = parseAndValidateMainSector(env.MAINSECTOR);
  const subsectors = parseAndValidateSubsectors(env.SUBSECTORSALLOWED);
  return buildSectorsFromMainAndSubsectors(main, subsectors);
}

function getHostEnv(key: string): string | undefined {
  const newKey = `HOST_${key}`;
  const legacyKey = `ORG_HOST_${key}`;
  return process.env[newKey] ?? process.env[legacyKey];
}

export function getConfig(): IServerConfig {
  if (!configInstance) {
    const port = parseInt(process.env.PORT || process.env.HOST_INTERNAL_PORT || '3300', 10);
    const isCloudRun = Boolean(process.env.K_SERVICE || process.env.K_REVISION || process.env.K_CONFIGURATION);
    const apiHostname = isCloudRun ? '0.0.0.0' : (process.env.HOST_INTERNAL_IP || 'localhost');
    const apiBaseUrl = determineApiBaseUrl(port, apiHostname);

    const localServiceRoles = (process.env.LOCAL_SERVICE_ROLE || 'HOST')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);

    const nodeEnv = process.env.NODE_ENV || 'development';
    const securityMode = parseSecurityMode(process.env.SECURITY_MODE);
    const networkMode = parseNetworkMode(process.env.NETWORK_MODE, nodeEnv);
    const fhirLegacy = parseBooleanEnv(process.env.FHIR_LEGACY, false);
    const jsonLegacy = parseBooleanEnv(process.env.JSON_LEGACY, false);
    const didcommPlainEnabled = parseBooleanEnv(process.env.DIDCOMM_PLAIN, false);
    const demoAllowInsecureBearer = parseBooleanEnv(process.env.DEMO_ALLOW_INSECURE_BEARER, false);

    configInstance = {
      securityMode,
      networkMode,
      fhirLegacy,
      jsonLegacy,
      didcommPlainEnabled,
      demoAllowInsecureBearer,
      nodeEnv,
      port: port,
      apiHostname,
      hostExternalDomain: process.env.HOST_EXTERNAL_DOMAIN || new URL(apiBaseUrl).host,
      apiBaseUrl,
      namespace: process.env.URN_NAMESPACE || 'gdc',
      sectorsAllowed: resolveAllowedSectorsFromEnv(process.env),
      allowedPaymentMethods: (process.env.ALLOWED_PAYMENT_METHODS || 'Stripe').split(','),
      dbProvider: process.env.DB_PROVIDER || 'mem',
      storageProvider: process.env.STORAGE_PROVIDER || 'mem',
      queueProvider: process.env.QUEUE_PROVIDER || 'mem',
      postgres: {
        host: process.env.POSTGRES_HOST,
        port: process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT, 10) : undefined,
        database: process.env.POSTGRES_DB,
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        ssl: parseBooleanEnv(process.env.POSTGRES_SSL, false),
        schema: process.env.POSTGRES_SCHEMA,
        maxPoolSize: process.env.POSTGRES_MAX_POOL_SIZE ? parseInt(process.env.POSTGRES_MAX_POOL_SIZE, 10) : undefined,
      },
      gcsBucketName: process.env.GCS_BUCKET_NAME,
      supabase: {
        url: process.env.SUPABASE_URL,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        storageBucket: process.env.SUPABASE_STORAGE_BUCKET,
        storagePublic: parseBooleanEnv(process.env.SUPABASE_STORAGE_PUBLIC, true),
      },
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
