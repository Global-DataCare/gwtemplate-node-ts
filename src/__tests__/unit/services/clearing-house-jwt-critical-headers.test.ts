// Flow contract: real KMS-signed PQC JWTs verify with pinned keys, but an unknown critical JOSE extension is rejected even when its signature is valid; no signature failure or demo mode substitutes for extension handling.
import { randomUUID } from 'node:crypto';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { AdapterCryptoSdkNode } from '../../../gdc-backend-utils-node/adapters/node/crypto';
import { KmsService } from '../../../services/KmsService';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { verifyPinnedJwt } from '../../../services/ClearingHouseService';
import { EXAMPLE_CONTROLLER_DID } from 'gdc-common-utils-ts/examples/shared';

it('rejects an unhandled critical extension on an otherwise valid ML-DSA JWT', async () => {
  const crypto = new CryptographyService(new AdapterCryptoSdkNode());
  let kms: KmsService;
  const tenants = new TenantsCacheManager(new VaultMemRepository(), () => kms, 'test-host-collection');
  kms = new KmsService(crypto, tenants);
  try {
    await kms.init(); const vault = randomUUID(); await kms.provisionKeys(vault);
    const key = await kms.getPublicVerificationKey(vault, undefined, 'comm_sig');
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: EXAMPLE_CONTROLLER_DID, iat: now, exp: now + 60, jti: randomUUID() };
    const signed = await kms.createCompactJws(payload, key.kid!, vault, 'comm_sig');
    await expect(verifyPinnedJwt(signed, { keys: [key as any] }, payload.iss, now, { cryptography: crypto })).resolves.toMatchObject(payload);
    const critical = await kms.createCompactJws(payload, key.kid!, vault, 'comm_sig', { crit: ['unhandled'], unhandled: true });
    expect(await crypto.verifyJws(critical, key)).toBe(true);
    await expect(verifyPinnedJwt(critical, { keys: [key as any] }, payload.iss, now, { cryptography: crypto })).rejects.toThrow(/critical|extension/i);
  } finally { kms.destroy(); }
});
