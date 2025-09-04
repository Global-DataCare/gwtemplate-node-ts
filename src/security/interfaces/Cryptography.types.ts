// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/security/interfaces/Cryptography.types.ts

import { JobRequest } from "../../models/request";

export interface RecipientInfo {
  tenantId: string;
  header?: Record<string, any>;
}

export interface SignerInfo {
  tenantId: string;
  protectedHeader: Record<string, any>;
  unprotectedHeader?: Record<string, any>;
}

export interface ProtectRequest {
  stream: Uint8Array;
  recipients: RecipientInfo[];
  protectedHeader?: Record<string, any>; // is it meta.jws.protected?
  unprotectedHeader?: Record<string, any>; // is it meta.jws.unprotected?
  aad?: Uint8Array;// src/adapters/queue.ts
  input: Record<string, any>;
  meta?: {
    jws?: { protected?: Record<string, any>; unprotected?: Record<string, any>;}; // protected and unprotected headers
    jwe?: { header?: Record<string, any>; }; // public unencypted header from the JWE
    bearer?: { jwt: { header?: Record<string, any>; payload?: Record<string, any>; } }
  };
}

export interface QueueAdapter {
  addJob(jobName: string, request: JobRequest, priority?: number): Promise<void>;
}

export interface JweObject {
  protected?: string;
  unprotected?: Record<string, any>;
  recipients: Array<{
    header?: Record<string, any>;
    encrypted_key?: string;
  }>;
  aad?: string;
  iv: string;
  ciphertext: string;
  tag: string;
}

export interface SignRequest {
  payload: Uint8Array;
  signers: SignerInfo[];
}

export interface JwsObject {
  payload: string;
  signatures: Array<{
    protected: string;
    unprotected?: Record<string, any>;
    signature: string;
  }>;
}
