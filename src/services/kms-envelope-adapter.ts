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

