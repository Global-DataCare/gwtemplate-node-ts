import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

export interface KmsEnvelopeAdapter {
  wrapKeyMaterial(plaintext: Uint8Array, context: { entityVaultId: string; purpose: string }): Promise<string>;
  unwrapKeyMaterial(wrapped: string, context: { entityVaultId: string; purpose: string }): Promise<Uint8Array>;
}

/**
 * Development adapter that keeps behavior deterministic and side-effect free.
 * Production should replace this implementation with Cloud KMS/HSM calls.
 */
export class InMemoryEnvelopeAdapter implements KmsEnvelopeAdapter {
  async wrapKeyMaterial(plaintext: Uint8Array): Promise<string> {
    return Buffer.from(plaintext).toString('base64url');
  }

  async unwrapKeyMaterial(wrapped: string): Promise<Uint8Array> {
    return Buffer.from(wrapped, 'base64url');
  }
}

export class AesGcmEnvelopeAdapter implements KmsEnvelopeAdapter {
  private readonly kek: Buffer;

  constructor(secret: string) {
    const normalized = String(secret || '').trim();
    if (!normalized) {
      throw new Error('AesGcmEnvelopeAdapter requires a non-empty KEK secret.');
    }
    this.kek = createHash('sha256').update(normalized, 'utf8').digest();
  }

  async wrapKeyMaterial(plaintext: Uint8Array): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.kek, iv);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64url');
  }

  async unwrapKeyMaterial(wrapped: string): Promise<Uint8Array> {
    const bytes = Buffer.from(wrapped, 'base64url');
    if (bytes.length < 28) {
      throw new Error('Wrapped key material is invalid or truncated.');
    }
    const iv = bytes.subarray(0, 12);
    const authTag = bytes.subarray(12, 28);
    const ciphertext = bytes.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.kek, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return new Uint8Array(plaintext);
  }
}
