// src/adapters/credential-ledger-resolver.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { CredentialLedgerContext, ICredentialLedgerAdapter } from './ICredentialLedgerAdapter';

export type LedgerProviderName = 'mem' | 'fabric' | 'pontusx' | 'multi';

export function parseLedgerProviderMap(input?: string): Record<string, string> {
  if (!input) return {};
  return input
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const [network, provider] = entry.split('=').map((value) => value.trim());
      if (network && provider) acc[network] = provider;
      return acc;
    }, {});
}

export class CredentialLedgerResolver implements ICredentialLedgerAdapter {
  private defaultProvider: string;
  private providerMap: Record<string, string>;
  private providers: Record<string, ICredentialLedgerAdapter>;

  constructor(options: {
    defaultProvider: string;
    providerMap: Record<string, string>;
    providers: Record<string, ICredentialLedgerAdapter>;
  }) {
    this.defaultProvider = options.defaultProvider;
    this.providerMap = options.providerMap;
    this.providers = options.providers;
  }

  public resolveProviderName(network: string): string {
    return this.providerMap[network] || this.defaultProvider;
  }

  public getProviderForNetwork(network: string): ICredentialLedgerAdapter | undefined {
    return this.providers[this.resolveProviderName(network)];
  }

  public async getCredentialStatus(id: string, network: string, context?: CredentialLedgerContext) {
    const provider = this.getProviderForNetwork(network);
    if (!provider) {
      throw new Error(`No ledger provider configured for network "${network}".`);
    }
    return provider.getCredentialStatus(id, network, context);
  }

  public async getCredentialHistory(id: string, network: string, context?: CredentialLedgerContext) {
    const provider = this.getProviderForNetwork(network);
    if (!provider) {
      throw new Error(`No ledger provider configured for network "${network}".`);
    }
    return provider.getCredentialHistory(id, network, context);
  }
}
