// src/utils/fhir-versioning.ts
// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';

export type FhirCidVersionMapping = {
  resourceType?: string;
  resourceId?: string;
  fullUrl?: string;
  cid: string;
  versionId: string;
};

const MULTIHASH_SHA2_256_CODE = 0x12;
const MULTIHASH_SHA2_256_LEN = 32;
const CID_V1 = 0x01;
const DEFAULT_MULTICODEC_DAG_JSON = 0x0129;

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
      if (key === 'meta' && asRecord[key] && typeof asRecord[key] === 'object' && !Array.isArray(asRecord[key])) {
        const meta = { ...(asRecord[key] as Record<string, unknown>) };
        delete meta.versionId;
        out[key] = canonicalizeValue(meta, depth + 1);
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
  const digest = sha256(utf8ToBytes(canonicalJson));
  const multihash = concatBytes(Uint8Array.from([MULTIHASH_SHA2_256_CODE, MULTIHASH_SHA2_256_LEN]), digest);
  const cidBytes = concatBytes(
    encodeVarint(CID_V1),
    encodeVarint(DEFAULT_MULTICODEC_DAG_JSON),
    multihash,
  );
  const cid = encodeMultibase58btc(cidBytes);
  return { cid, versionId: cid };
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
      fullUrl: entry?.fullUrl ? String(entry.fullUrl) : undefined,
      cid,
      versionId,
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
  const { blockchainAdapter, sector, jurisdiction, mappings } = params;
  if (!blockchainAdapter?.registerCidVersionMappings) return;
  if (!mappings || mappings.length === 0) return;

  const channel = `${sector}-${String(jurisdiction || '').trim().toLowerCase()}`;
  const chaincode = process.env.FHIR_VERSION_LEDGER_CHAINCODE || 'fhir-versioning';
  await blockchainAdapter.registerCidVersionMappings(mappings, channel, chaincode);
}
