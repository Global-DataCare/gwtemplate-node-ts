// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/ledger.ts

import { normalizeSegment } from './slug';

export function resolveIdentityChannel(jurisdiction?: string): string {
  const normalized = jurisdiction ? normalizeSegment(jurisdiction) : '';
  if (normalized) return `${normalized}-identity`;
  return 'eu-identity';
}
