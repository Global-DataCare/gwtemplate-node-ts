import { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { VerificationMethod } from '../gdc-backend-utils-node/models/did';
import { resolveIdentityChannel } from './ledger';
import { ManageAssetCryptographicKey, type CryptographicKeyLedgerPayload } from '../blockchain/fabric/v3/manageAssetCryptographicKey';
import { ManageAssetSubjectKeyBinding } from '../blockchain/fabric/v3/manageAssetSubjectKeyBinding';
import { shouldUseFabricLedger } from '../adapters/credential-ledger-resolver';
import {
  hashLedgerString,
  inferLedgerJwkUse,
  tryGetJwkThumbprint,
} from './ledger-organization-registration-helpers';

function shouldSyncIdentityLedger(): boolean {
  return shouldUseFabricLedger();
}

function getLedgerMspId(): string | undefined {
  return String(
    process.env.LEDGER_MSP_ID
    || process.env.HLF_MSP_ID_ORG1
    || '',
  ).trim() || undefined;
}

function resolveLedgerKeyId(method: Pick<VerificationMethod, 'id' | 'publicKeyJwk'>): string {
  const thumbprint = tryGetJwkThumbprint(method.publicKeyJwk);
  return thumbprint
    || String(method.id || '').trim()
    || String(method.publicKeyJwk?.kid || '').trim()
    || `key_${hashLedgerString(JSON.stringify(method.publicKeyJwk || {})).slice(0, 32)}`;
}

export async function registerSubjectKeysOnLedger(params: {
  jurisdiction?: string;
  organizationId: string;
  subjectType: 'employee' | 'person';
  subjectId: string;
  verificationMethods: VerificationMethod[];
  deviceId?: string;
}): Promise<void> {
  if (!shouldSyncIdentityLedger()) return;

  const mspId = getLedgerMspId();
  if (!mspId) return;

  const channelName = resolveIdentityChannel(params.jurisdiction);
  const keyManager = new ManageAssetCryptographicKey({
    chaincodeName: process.env.LEDGER_CRYPTOGRAPHIC_KEY_CHAINCODE || 'cryptographickey-sc',
    channelName,
  });
  const bindingManager = new ManageAssetSubjectKeyBinding({
    chaincodeName: process.env.LEDGER_SUBJECT_KEY_BINDING_CHAINCODE || 'subjectkeybinding-sc',
    channelName,
  });

  for (const method of params.verificationMethods) {
    const publicKeyJwk = method.publicKeyJwk as PublicJwk | undefined;
    if (!publicKeyJwk) continue;

    const thumbprint = tryGetJwkThumbprint(publicKeyJwk);
    const keyId = resolveLedgerKeyId(method);
    const use = String((publicKeyJwk as any)?.use || '').trim() || inferLedgerJwkUse(publicKeyJwk);
    const relationship = use === 'enc' ? 'employee-device-encryption' : 'employee-device-signing';

    const keyPayload: CryptographicKeyLedgerPayload = {
      keyId,
      orgId: params.organizationId,
      kid: publicKeyJwk.kid,
      thumbprint: thumbprint || undefined,
      kty: publicKeyJwk.kty,
      crv: (publicKeyJwk as any).crv,
      alg: (publicKeyJwk as any).alg,
      use: use as CryptographicKeyLedgerPayload['use'],
      purpose: relationship,
      status: 'active',
      origin: 'did:web',
    };

    try {
      await keyManager.registerKey(mspId, keyId, keyPayload);
    } catch (error: any) {
      const message = String(error?.message || error);
      if (!message.includes('already exists')) throw error;
    }

    const bindingId = `${params.subjectType}_${params.subjectId}__${keyId}`;
    await bindingManager.upsertSubjectKeyBinding(mspId, bindingId, {
      bindingId,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      parentOrgId: params.organizationId,
      keyId,
      relationship,
      status: 'active',
      meta: {
        attributes: {
          did: params.subjectId,
          verificationMethodId: method.id,
          kid: publicKeyJwk.kid,
          deviceId: params.deviceId,
          thumbprintMissing: !thumbprint,
        },
      },
    });
  }
}

export async function revokeSubjectKeysOnLedger(params: {
  jurisdiction?: string;
  organizationId: string;
  subjectType: 'employee' | 'person';
  subjectId: string;
  verificationMethods: VerificationMethod[];
  deviceId?: string;
  revokedAtEpochSec?: number;
}): Promise<void> {
  if (!shouldSyncIdentityLedger()) return;

  const mspId = getLedgerMspId();
  if (!mspId) return;

  const channelName = resolveIdentityChannel(params.jurisdiction);
  const revokedAt = String(params.revokedAtEpochSec || Math.floor(Date.now() / 1000));
  const keyManager = new ManageAssetCryptographicKey({
    chaincodeName: process.env.LEDGER_CRYPTOGRAPHIC_KEY_CHAINCODE || 'cryptographickey-sc',
    channelName,
  });
  const bindingManager = new ManageAssetSubjectKeyBinding({
    chaincodeName: process.env.LEDGER_SUBJECT_KEY_BINDING_CHAINCODE || 'subjectkeybinding-sc',
    channelName,
  });

  for (const method of params.verificationMethods) {
    const publicKeyJwk = method.publicKeyJwk as PublicJwk | undefined;
    const keyId = resolveLedgerKeyId(method);
    const use = publicKeyJwk ? inferLedgerJwkUse(publicKeyJwk) : 'sig';
    const relationship = use === 'enc' ? 'employee-device-encryption' : 'employee-device-signing';
    const bindingId = `${params.subjectType}_${params.subjectId}__${keyId}`;

    await keyManager.submit(mspId, 'UpdateKeyStatus', keyId, 'revoked', revokedAt);
    await bindingManager.upsertSubjectKeyBinding(mspId, bindingId, {
      bindingId,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      parentOrgId: params.organizationId,
      keyId,
      relationship,
      status: 'revoked',
      meta: {
        attributes: {
          did: params.subjectId,
          verificationMethodId: method.id,
          kid: publicKeyJwk?.kid,
          deviceId: params.deviceId,
          revokedAt,
        },
      },
    });
  }
}
