// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/MessagingManager.ts

import { v4 as uuidv4 } from 'uuid';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { BundleJsonApi, BundleEntry, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { createOperationOutcome } from '../utils/outcome';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { getTenantVaultId } from '../utils/tenant';
import { getEnvSectionId } from '../utils/section-env';

type MessagingAction = '_send' | '_receive' | '_messages' | '_get' | '_delete';

export class MessagingManager {
  private vaultRepository: IVaultRepository;
  private kmsService: IKmsService;

  constructor(vaultRepository: IVaultRepository, kmsService: IKmsService) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
  }

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const issuerDid = job.content?.iss || 'did:web:messaging.local';
    const action = String(job.action || '').trim() as MessagingAction;
    if (!action) {
      throw new ManagerError('Missing action.', IssueType.Required);
    }

    try {
      const resultEntry = await this.handleAction(job, action);
      const responseBundle: BundleJsonApi = {
        data: [resultEntry],
        resourceType: 'Bundle',
        type: getBundleResponseTypeForAction(job.action),
        total: 1,
      };

      return {
        jti: uuidv4(),
        type: 'messaging-response',
        thid: job.content?.thid as string,
        iss: issuerDid,
        aud: job.content?.iss as string,
        exp: Math.floor(Date.now() / 1000) + 300,
        body: responseBundle,
      };
    } catch (error: any) {
      const errorEntry: ErrorEntry = {
        type: 'MessagingResponse-v1.0',
        response: {
          status: error?.status || '500',
          outcome: createOperationOutcome(
            IssueLevel.Error,
            error?.code || IssueType.Exception,
            error?.message || 'Messaging action failed',
          ),
        },
      };
      const responseBundle: BundleJsonApi = {
        data: [errorEntry],
        resourceType: 'Bundle',
        type: getBundleResponseTypeForAction(job.action),
        total: 1,
      };
      return {
        jti: uuidv4(),
        type: 'messaging-response',
        thid: job.content?.thid as string,
        iss: issuerDid,
        aud: job.content?.iss as string,
        exp: Math.floor(Date.now() / 1000) + 300,
        body: responseBundle,
      };
    }
  }

  private async handleAction(job: JobRequest, action: MessagingAction): Promise<BundleEntry> {
    const tenantId = job.tenantId;
    const sector = job.sector;
    if (!tenantId || !sector) {
      throw new ManagerError('Missing tenantId or sector.', IssueType.Required);
    }
    const vaultId = tenantId === 'host' ? 'host' : getTenantVaultId(sector, tenantId);

    switch (action) {
      case '_send': {
        const payload = job.content?.body || {};
        const messageId = payload.id || payload.messageId || uuidv4();
        const messageDoc: ConfidentialStorageDoc = {
          id: messageId,
          status: 'active',
          sequence: 0,
          content: {
            ...payload,
            meta: { ...(payload.meta || {}), storedAt: new Date().toISOString() },
          },
        };
        const secureDoc = await this.kmsService.protectConfidentialData(messageDoc, vaultId);
        await this.vaultRepository.put(vaultId, [secureDoc], getEnvSectionId('messaging'));
        return { type: 'MessagingSendResponse-v1.0', meta: { claims: { id: messageId } }, response: { status: '201' } };
      }
      case '_messages': {
        const docs = await this.vaultRepository.getContainersInSection<any>(vaultId, getEnvSectionId('messaging'));
        return { type: 'MessagingListResponse-v1.0', meta: { claims: { count: docs.length } }, response: { status: '200' } };
      }
      case '_get': {
        const messageId = job.content?.body?.id || job.content?.body?.messageId;
        if (!messageId) throw new ManagerError('Missing message id.', IssueType.Required);
        const doc = await this.vaultRepository.get<any>(vaultId, messageId, getEnvSectionId('messaging'));
        if (!doc) throw new ManagerError('Message not found.', IssueType.NotFound);
        return { type: 'MessagingGetResponse-v1.0', meta: { claims: { id: messageId } }, response: { status: '200' }, resource: doc };
      }
      case '_delete': {
        const messageId = job.content?.body?.id || job.content?.body?.messageId;
        if (!messageId) throw new ManagerError('Missing message id.', IssueType.Required);
        await this.vaultRepository.delete(vaultId, messageId, getEnvSectionId('messaging'));
        return { type: 'MessagingDeleteResponse-v1.0', meta: { claims: { id: messageId } }, response: { status: '204' } };
      }
      case '_receive':
      default:
        return { type: 'MessagingReceiveResponse-v1.0', response: { status: '202' } };
    }
  }
}
