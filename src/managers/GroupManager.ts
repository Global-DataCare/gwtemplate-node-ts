// src/managers/GroupManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4 } from 'uuid';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { normalizeInteroperableClaims } from '../utils/claims';
import { RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import { getEnvSectionId } from '../utils/section-env';

export interface GroupInput {
  vaultId: string; // The vault where this group definition will be stored
  payload: {
    '@context': 'internal.json';
    '@type': 'Group';
    claims: Record<string, any>;
  };
}

export class GroupManager {
  private vaultRepository: IVaultRepository;

  constructor(vaultRepository: IVaultRepository) {
    this.vaultRepository = vaultRepository;
  }

  async set(input: GroupInput): Promise<any> {
    const groupId = uuidv4();

    const normalizedClaims = normalizeInteroperableClaims(
      input.payload,
    );

    const groupDocument: RecordBase & { claims: any; '@context': string; '@type': string; meta?: Record<string, any> } = {
      id: groupId,
      '@context': input.payload['@context'],
      '@type': input.payload['@type'],
      claims: normalizedClaims,
      meta: {
        lastUpdated: new Date().toISOString()
      }
    };

    await this.vaultRepository.put(input.vaultId, [groupDocument], getEnvSectionId('groups'));

    return groupDocument;
  }
}
