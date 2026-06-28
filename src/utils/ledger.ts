// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/ledger.ts

import { normalizeSegment } from './slug';

export function resolveIdentityChannel(jurisdiction?: string): string {
  const explicitDefault = String(process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT || '').trim();
  if (explicitDefault) return explicitDefault;

  const networkMode = String(process.env.NETWORK_MODE || '').trim().toLowerCase();
  if (networkMode === 'local-network') return 'identity-local';

  const normalized = jurisdiction ? normalizeSegment(jurisdiction) : '';
  if (normalized) return `${normalized}-identity`;
  return 'eu-identity';
}
