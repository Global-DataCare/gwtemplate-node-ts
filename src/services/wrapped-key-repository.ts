export type WrappedKeyPurpose = 'hmac' | 'storage' | 'comm_sig' | 'vc_sign' | 'encryption';

export type WrappedKeyRecord = {
  entityVaultId: string;
  purpose: WrappedKeyPurpose;
  keyVersion: string;
  wrappedKeyMaterial: string;
  updatedAt: string;
};

export interface WrappedKeyRepository {
  put(record: WrappedKeyRecord): Promise<void>;
  get(entityVaultId: string, purpose: WrappedKeyPurpose, keyVersion?: string): Promise<WrappedKeyRecord | undefined>;
}

export class InMemoryWrappedKeyRepository implements WrappedKeyRepository {
  private readonly records = new Map<string, WrappedKeyRecord>();

  async put(record: WrappedKeyRecord): Promise<void> {
    this.records.set(this.buildKey(record.entityVaultId, record.purpose, record.keyVersion), record);
  }

  async get(entityVaultId: string, purpose: WrappedKeyPurpose, keyVersion?: string): Promise<WrappedKeyRecord | undefined> {
    if (keyVersion) {
      return this.records.get(this.buildKey(entityVaultId, purpose, keyVersion));
    }

    const prefix = `${entityVaultId}::${purpose}::`;
    const matches = Array.from(this.records.entries())
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right));
    return matches.at(-1)?.[1];
  }

  private buildKey(entityVaultId: string, purpose: WrappedKeyPurpose, keyVersion: string): string {
    return `${entityVaultId}::${purpose}::${keyVersion}`;
  }
}
