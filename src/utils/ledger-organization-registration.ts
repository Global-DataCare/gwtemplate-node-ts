import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { OrganizationConfig } from '../gdc-backend-utils-node/models/entity';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { PdfSignatureEvidence } from './pdf-evidence';
import { ILogger } from '../loggers/ILogger';
import { resolveIdentityChannel } from './ledger';
import { ManageAssetOrganization } from '../blockchain/fabric/v3/manageAssetOrganization';
import { ManageAssetArtifact } from '../blockchain/fabric/v3/manageAssetArtifact';
import { ManageAssetArtifactEvent } from '../blockchain/fabric/v3/manageAssetArtifactEvent';
import { ManageAssetCryptographicKey } from '../blockchain/fabric/v3/manageAssetCryptographicKey';
import { ManageAssetSubjectKeyBinding } from '../blockchain/fabric/v3/manageAssetSubjectKeyBinding';
import type { CryptographicKeyLedgerPayload } from '../blockchain/fabric/v3/manageAssetCryptographicKey';
import {
  hashLedgerString,
  inferLedgerJwkUse,
  tryGetJwkThumbprint,
} from './ledger-organization-registration-helpers';

type LedgerConfig = {
  enabled?: boolean;
  mspId?: string;
  channelName?: string;
  chaincodeName?: string;
  schemaUrl?: string;
};

export async function registerOrganizationOnLedger(params: {
  ledgerConfig?: LedgerConfig;
  hostJurisdiction?: string;
  namespace: string;
  hostExternalDomain: string;
  logger: ILogger;
  orgId: string;
  organization: IncludedResource;
  config: OrganizationConfig;
  evidence?: PdfSignatureEvidence[];
  role: 'host' | 'tenant';
  sector: Sector;
  jurisdiction?: string;
}): Promise<void> {
  const mspId = params.ledgerConfig?.mspId || process.env.LEDGER_MSP_ID || process.env.HLF_MSP_ID_ORG1;
  if (!mspId) {
    throw new ManagerError('Ledger MSP ID is missing. Set LEDGER_MSP_ID.', IssueType.Exception);
  }

  const chaincodeName = params.ledgerConfig?.chaincodeName || process.env.LEDGER_ORG_CHAINCODE;
  const channelName = params.ledgerConfig?.channelName
    || resolveIdentityChannel(params.jurisdiction || params.hostJurisdiction);
  const manager = new ManageAssetOrganization({ chaincodeName, channelName });

  const payload = {
    orgId: params.orgId,
    vc: params.config.governanceVc || params.config.selfDescriptionVc,
  };

  if (!payload.vc) {
    throw new ManagerError('Organization VC is missing for ledger registration.', IssueType.Exception);
  }

  try {
    await manager.createOrganization(mspId, params.orgId, payload);
    await registerOrganizationKeysOnLedger({
      logger: params.logger,
      mspId,
      channelName,
      orgId: params.orgId,
      didDocumentId: params.config.didDocument?.id,
      verificationMethods: params.config.didDocument?.verificationMethod,
    });
    await registerOrganizationArtifactsOnLedger({
      mspId,
      channelName,
      orgId: params.orgId,
      role: params.role,
      evidence: params.evidence,
    });
  } catch (error: any) {
    const message = String(error?.message || error);
    if (message.includes('EvidenceAlreadyRegistered')) {
      throw new ManagerError('Evidence already registered for another organization.', IssueType.Conflict);
    }
    if (message.includes('already exists')) {
      throw new ManagerError('Organization already registered on ledger.', IssueType.Conflict);
    }
    throw new ManagerError(`Ledger registration failed: ${message}`, IssueType.Exception);
  }
}

async function registerOrganizationKeysOnLedger(params: {
  logger: ILogger;
  mspId: string;
  channelName: string;
  orgId: string;
  didDocumentId?: string;
  verificationMethods?: Array<{ id?: string; publicKeyJwk?: PublicJwk }>;
}): Promise<void> {
  const methods = Array.isArray(params.verificationMethods) ? params.verificationMethods : [];
  params.logger.debug('[HostingManager] ledger key registration start', {
    component: 'HostingManager.registerOrganizationKeysOnLedger',
    orgId: params.orgId,
    channelName: params.channelName,
    didDocumentId: params.didDocumentId,
    verificationMethodCount: methods.length,
  });
  if (methods.length === 0) return;

  const keyManager = new ManageAssetCryptographicKey({
    chaincodeName: process.env.LEDGER_CRYPTOGRAPHIC_KEY_CHAINCODE || 'cryptographickey-sc',
    channelName: params.channelName,
  });
  const bindingManager = new ManageAssetSubjectKeyBinding({
    chaincodeName: process.env.LEDGER_SUBJECT_KEY_BINDING_CHAINCODE || 'subjectkeybinding-sc',
    channelName: params.channelName,
  });

  for (const method of methods) {
    const publicKeyJwk = method?.publicKeyJwk as PublicJwk | undefined;
    if (!publicKeyJwk) continue;

    const thumbprint = tryGetJwkThumbprint(publicKeyJwk);
    const keyId = thumbprint
      || String(method?.id || '').trim()
      || String(publicKeyJwk.kid || '').trim()
      || `key_${hashLedgerString(JSON.stringify(publicKeyJwk)).slice(0, 32)}`;
    const use = String((publicKeyJwk as any)?.use || '').trim() || inferLedgerJwkUse(publicKeyJwk);
    const relationship = use === 'enc' ? 'organization-encryption' : 'organization-signing';

    const keyPayload: CryptographicKeyLedgerPayload = {
      keyId,
      orgId: params.orgId,
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
      await keyManager.registerKey(params.mspId, keyId, keyPayload);
      params.logger.debug('[HostingManager] ledger key registered', {
        component: 'HostingManager.registerOrganizationKeysOnLedger',
        orgId: params.orgId,
        keyId,
        kid: publicKeyJwk.kid,
        thumbprintMissing: !thumbprint,
      });
    } catch (error: any) {
      const message = String(error?.message || error);
      if (!message.includes('already exists')) throw error;
      params.logger.debug('[HostingManager] ledger key already exists', {
        component: 'HostingManager.registerOrganizationKeysOnLedger',
        orgId: params.orgId,
        keyId,
        kid: publicKeyJwk.kid,
      });
    }

    const bindingId = `organization_${params.orgId}__${keyId}`;
    await bindingManager.upsertSubjectKeyBinding(params.mspId, bindingId, {
      bindingId,
      subjectType: 'organization',
      subjectId: params.orgId,
      parentOrgId: params.orgId,
      keyId,
      relationship,
      status: 'active',
      meta: {
        attributes: {
          did: params.didDocumentId,
          verificationMethodId: method?.id,
          kid: publicKeyJwk.kid,
          thumbprintMissing: !thumbprint,
        },
      },
    });
    params.logger.debug('[HostingManager] ledger subject-key binding upserted', {
      component: 'HostingManager.registerOrganizationKeysOnLedger',
      orgId: params.orgId,
      bindingId,
      keyId,
    });
  }
}

async function registerOrganizationArtifactsOnLedger(params: {
  mspId: string;
  channelName: string;
  orgId: string;
  role: 'host' | 'tenant';
  evidence?: PdfSignatureEvidence[];
}): Promise<void> {
  const evidenceList = Array.isArray(params.evidence) ? params.evidence : [];
  if (evidenceList.length === 0) return;

  const artifactManager = new ManageAssetArtifact({
    chaincodeName: process.env.LEDGER_ARTIFACT_CHAINCODE || 'artifact-sc',
    channelName: params.channelName,
  });
  const eventManager = new ManageAssetArtifactEvent({
    chaincodeName: process.env.LEDGER_ARTIFACT_EVENT_CHAINCODE || 'artifactevent-sc',
    channelName: params.channelName,
  });

  for (const evidence of evidenceList) {
    const signedDigest = evidence?.digest?.find((item) => item?.type === 'SignedDocumentHash');
    const unsignedDigest = evidence?.digest?.find((item) => item?.type === 'DocumentHash');
    const signedHash = signedDigest?.hashValue;
    const signedAlg = String(signedDigest?.hashAlg || 'SHA256').toLowerCase();
    if (!signedHash) continue;

    const artifactId = `artifact_${signedAlg}_${signedHash}`;
    await artifactManager.upsertArtifact(params.mspId, artifactId, {
      artifactId,
      hash: signedHash,
      hashAlg: signedAlg,
      artifactType: 'pdf',
      declaredBy: params.orgId,
      declaredByType: params.role,
      status: 'declared',
      meta: {
        attributes: {
          unsignedDocumentHash: unsignedDigest?.hashValue,
          unsignedDocumentHashAlg: unsignedDigest?.hashAlg,
          signatureType: evidence?.signature?.type,
        },
      },
    });

    const eventHashSource = JSON.stringify(evidence);
    const eventId = `${artifactId}__signature-observed-${hashLedgerString(eventHashSource).slice(0, 24)}`;
    try {
      await eventManager.createArtifactEvent(params.mspId, eventId, {
        eventId,
        artifactId,
        eventType: 'declaration',
        eventSubType: 'pdf-signature-observed',
        actor: params.orgId,
        actorType: params.role,
        status: 'active',
        artifactHash: signedHash,
        artifactHashAlg: signedAlg,
        evidenceHash: hashLedgerString(eventHashSource),
        evidenceHashAlg: 'sha256',
        meta: {
          attributes: {
            x5cLength: Array.isArray(evidence?.x5c) ? evidence.x5c.length : 0,
            signatureType: evidence?.signature?.type,
          },
        },
      });
    } catch (error: any) {
      const message = String(error?.message || error);
      if (!message.includes('already exists')) throw error;
    }
  }
}
