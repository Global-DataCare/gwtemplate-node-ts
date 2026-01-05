// src/auth/FirebaseTokenVerifier.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import admin from 'firebase-admin';
import { ITokenVerifier, VerificationResult } from './ITokenVerifier';

/**
 * Verifies Firebase ID tokens (issuer: https://securetoken.google.com/<projectId>).
 *
 * Requires Firebase Admin SDK to be initialized (see `src/utils/firebase.ts`).
 */
export class FirebaseTokenVerifier implements ITokenVerifier {
  public async verify(token: string): Promise<VerificationResult> {
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      return { valid: true, payload: decoded };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      return { valid: false, error: message };
    }
  }
}
