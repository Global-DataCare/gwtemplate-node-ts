// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/ledger.ts

import { GLOBAL_HUMAN_IDENTITY_CHANNEL } from '../blockchain/fabric/v3/ledger-channel-name';

export function resolveIdentityChannel(jurisdiction?: string): string {
  const explicitDefault = String(process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT || '').trim();
  if (explicitDefault) return explicitDefault;

  const networkMode = String(process.env.NETWORK_MODE || '').trim().toLowerCase();
  if (networkMode === 'local-network') return 'identity-local';

  // Jurisdiction intentionally does not scope human identity. A person may
  // hold credentials from several jurisdictions.
  void jurisdiction;
  return GLOBAL_HUMAN_IDENTITY_CHANNEL;
}
