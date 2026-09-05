// src/utils/fhir-versioning.ts
// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import { sha3_384 } from '@noble/hashes/sha3.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';
import type { LedgerSafeMetaTag } from '../services/ai/metaTagSanitizer';
import { extractLedgerSafeResearchTags } from './fhir-ingestion';
import { resolveDataChannel } from './ledger';

export type FhirCidVersionMapping = {
  resourceType?: string;
  resourceId?: string;
  cid: string;
  versionId: string;
  tags?: LedgerSafeMetaTag[];
};

const MULTIHASH_SHA3_384_CODE = 0x15;
const MULTIHASH_SHA3_384_LEN = 48;

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function encodeVarint(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid varint value ${value}`);
  const out: number[] = [];
  let n = value >>> 0;
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return Uint8Array.from(out);
}

function canonicalizeValue(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return value.map((v) => canonicalizeValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const asRecord = value as Record<string, unknown>;
    const keys = Object.keys(asRecord).sort();
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (depth === 0 && (key === 'id' || key === 'meta' || key === 'text')) {
        continue;
      }
      out[key] = canonicalizeValue(asRecord[key], depth + 1);
    }
    return out;
  }
  return value;
}

export function canonicalizeFhirResource(resource: Record<string, unknown>): string {
  return JSON.stringify(canonicalizeValue(resource, 0));
}

export function fhirResourceToCid(resource: Record<string, unknown>): { cid: string; versionId: string } {
  const canonicalJson = canonicalizeFhirResource(resource);
  const digest = sha3_384(utf8ToBytes(canonicalJson));
  const multihash = concatBytes(Uint8Array.from([MULTIHASH_SHA3_384_CODE, MULTIHASH_SHA3_384_LEN]), digest);
  const versionId = encodeMultibase58btc(multihash);
  return { cid: versionId, versionId };
}

export function applyFhirCidVersioningToEntry(params: {
  entry: any;
  claims?: Record<string, any>;
  resourceType: string;
  resourceId: string;
}): { versionId?: string; mapping?: FhirCidVersionMapping } {
  const { entry, claims, resourceType, resourceId } = params;
  const resource = entry?.resource;
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
    return {};
  }

  if (!resource.id) {
    resource.id = resourceId;
  }
  if (!resource.meta || typeof resource.meta !== 'object' || Array.isArray(resource.meta)) {
    resource.meta = {};
  }

  const { cid, versionId } = fhirResourceToCid(resource as Record<string, unknown>);
  resource.meta.versionId = versionId;

  if (claims && typeof claims === 'object') {
    const context = claims['@context'];
    claims[`${resourceType}.meta.versionId`] = versionId;
    if (typeof context === 'string' && context.trim().length > 0) {
      const prefix = context.endsWith('.') ? context : `${context}.`;
      claims[`${prefix}${resourceType}.meta.versionId`] = versionId;
    }
  }

  return {
    versionId,
    mapping: {
      resourceType,
      resourceId: String(resource.id || resourceId),
      cid,
      versionId,
      tags: extractLedgerSafeResearchTags(entry),
    },
  };
}

export async function registerFhirCidMappings(params: {
  blockchainAdapter?: {
    registerCidVersionMappings?: (
      mappings: FhirCidVersionMapping[],
      channel: string,
      chaincode: string,
    ) => Promise<{ accepted: number; txId?: string }>;
  };
  sector: string;
  jurisdiction: string;
  mappings: FhirCidVersionMapping[];
}): Promise<void> {
  const { blockchainAdapter, mappings } = params;
  if (!blockchainAdapter?.registerCidVersionMappings) return;
  if (!mappings || mappings.length === 0) return;

  const channel = resolveDataChannel();
  const chaincode = process.env.FHIR_VERSION_LEDGER_CHAINCODE || 'artifact-sc';
  await blockchainAdapter.registerCidVersionMappings(mappings, channel, chaincode);
}
