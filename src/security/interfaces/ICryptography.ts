// src/security/interfaces/ICryptography.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import {
  ProtectRequest,
  JweObject,
  SignRequest,
  JwsObject,
} from './Cryptography.types';

export interface ICryptography {
  encrypt(request: ProtectRequest): Promise<JweObject>;
  decrypt(jwe: JweObject, tenantId: string): Promise<Uint8Array>;
  sign(request: SignRequest): Promise<JwsObject>;
  verify(jws: JwsObject): Promise<{ verified: boolean; payload: Uint8Array }>;
  jwsToCompact(jws: JwsObject): string;
  jwsToJson(jws: JwsObject): string;
  parseJws(jwsString: string): JwsObject;
  jweToCompact(jwe: JweObject): string;
  jweToJson(jwe: JweObject): string;
  parseJwe(jweString: string): JweObject;
}

