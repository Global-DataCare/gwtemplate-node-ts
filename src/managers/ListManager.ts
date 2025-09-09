// src/managers/ListManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4 } from 'uuid';
import { VaultRepository } from '@/database/repositories/vault/vault.repository';
import { normalizeInteroperableClaims } from '@/utils/claims';
import { RecordBase } from '@/models/resource-document';

export interface ListInput {
  vaultId: string; // The patient's vault where this List will be stored
  payload: {
    '@context': 'internal.json';
    '@type': 'List';
    claims: Record<string, any>;
  };
}

export class ListManager {
  private vaultRepository: VaultRepository;

  constructor(vaultRepository: VaultRepository) {
    this.vaultRepository = vaultRepository;
  }

  async set(input: ListInput): Promise<any> {
    const listId = uuidv4();

    const normalizedClaims = normalizeInteroperableClaims(
      input.payload
    );

    const listDocument: RecordBase & { claims: any; '@context': string; '@type': string; entry: any[] } = {
      id: listId,
      vaultId: input.vaultId,
      '@context': input.payload['@context'],
      '@type': input.payload['@type'],
      claims: normalizedClaims,
      entry: [],
    };

    await this.vaultRepository.put(input.vaultId, [listDocument], 'lists');

    return listDocument;
  }

  async addGroup(listId: string, listVaultId: string, groupReference: Record<string, any>): Promise<any> {
    const list = await this.vaultRepository.get<any>(listVaultId, listId, 'lists');

    if (!list) {
      throw new Error(`List with id ${listId} not found in vault ${listVaultId}.`);
    }

    if (!list.entry) {
      list.entry = [];
    }

    list.entry.push({
      item: groupReference,
      date: new Date().toISOString(),
    });

    await this.vaultRepository.put(listVaultId, [list], 'lists');
    
    return list;
  }
}
