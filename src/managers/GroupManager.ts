// src/managers/GroupManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4 } from 'uuid';
import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { normalizeInteroperableClaims } from '../utils/claims';
import { RecordBase } from '../models/resource-document';

export interface GroupInput {
  vaultId: string; // The vault where this group definition will be stored
  payload: {
    '@context': 'internal.json';
    '@type': 'Group';
    claims: Record<string, any>;
  };
}

export class GroupManager {
  private vaultRepository: VaultRepository;

  constructor(vaultRepository: VaultRepository) {
    this.vaultRepository = vaultRepository;
  }

  async set(input: GroupInput): Promise<any> {
    const groupId = uuidv4();

    const normalizedClaims = normalizeInteroperableClaims(
      input.payload,
    );

    const groupDocument: RecordBase & { claims: any; '@context': string; '@type': string } = {
      id: groupId,
      vaultId: input.vaultId,
      '@context': input.payload['@context'],
      '@type': input.payload['@type'],
      claims: normalizedClaims,
      meta: {
        lastUpdated: new Date().toISOString()
      }
    };

    await this.vaultRepository.put(input.vaultId, [groupDocument], 'groups');

    return groupDocument;
  }
}

