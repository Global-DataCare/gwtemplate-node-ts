// src/blockchain/fabric/v3/manageAsset.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { Contract, Gateway } from '@hyperledger/fabric-gateway';
import type * as grpc from '@grpc/grpc-js';
import { newGatewayConnection, newGrpcConnection } from './connect';

type ContractSession = {
  contract: Contract;
  gateway: Gateway;
  client: grpc.Client;
};

const capitalize = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

export class ManageAsset {
  protected itemType: string;
  protected chaincodeName?: string;
  protected channel?: string;

  constructor(itemType: string, options?: { chaincodeName?: string; channelName?: string }) {
    this.itemType = itemType;
    this.chaincodeName = options?.chaincodeName;
    this.channel = options?.channelName;
  }

  protected getContractName(): string {
    return this.chaincodeName || `${this.itemType.toLowerCase()}-sc`;
  }

  protected getReadFunction(): string {
    return `read${capitalize(this.itemType)}`;
  }

  protected getHistoryFunction(): string {
    return `get${capitalize(this.itemType)}History`;
  }

  protected async withContract(mspId: string, handler: (session: ContractSession) => Promise<Uint8Array>): Promise<Uint8Array> {
    const client = await newGrpcConnection(mspId);
    const gateway = await newGatewayConnection(client, mspId);
    try {
      const channelName = this.channel || process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT || 'eu-identity';
      const network = await gateway.getNetwork(channelName);
      const contract = network.getContract(this.getContractName());
      return await handler({ contract, gateway, client });
    } finally {
      gateway.close();
      client.close();
    }
  }

  protected parseJson<T>(payload: Uint8Array): T {
    const text = Buffer.from(payload).toString('utf8');
    return JSON.parse(text) as T;
  }

  public async read(mspId: string, assetId: string): Promise<object> {
    const result = await this.withContract(mspId, async ({ contract }) => {
      return contract.evaluateTransaction(this.getReadFunction(), assetId);
    });
    return this.parseJson<object>(result);
  }

  public async history(mspId: string, assetId: string): Promise<object[]> {
    const result = await this.withContract(mspId, async ({ contract }) => {
      return contract.evaluateTransaction(this.getHistoryFunction(), assetId);
    });
    return this.parseJson<object[]>(result);
  }
}
