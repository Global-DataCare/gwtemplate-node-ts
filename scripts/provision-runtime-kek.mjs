import { randomBytes } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';

const keyName = required('GCP_KMS_KEY_NAME');
const runtimeKekId = required('GCP_KMS_RUNTIME_KEK_ID');
const runtimeKek = randomBytes(32);
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

try {
  const client = await auth.getClient();
  const access = await client.getAccessToken();
  const token = typeof access === 'string' ? access : access?.token;
  if (!token) throw new Error('Google authentication returned no access token.');
  const response = await fetch(`https://cloudkms.googleapis.com/v1/${keyName}:encrypt`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plaintext: runtimeKek.toString('base64'),
      additionalAuthenticatedData: Buffer.from(JSON.stringify({
        entityVaultId: runtimeKekId,
        purpose: 'service-runtime-kek-v1',
      })).toString('base64'),
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.ciphertext) throw new Error(body?.error?.message || `Cloud KMS encrypt failed (${response.status}).`);
  console.log(`GCP_KMS_RUNTIME_KEK_CIPHERTEXT=${body.ciphertext}`);
} finally {
  runtimeKek.fill(0);
}

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
