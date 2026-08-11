import type { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import type { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import type { DidDocument, VerificationMethod } from 'gdc-common-utils-ts/models/did';
import type { VerifiableCredentialV2 } from 'gdc-common-utils-ts/models/verifiable-credential';
import { ContractCredentialTypes } from 'gdc-common-utils-ts/constants/verifiable-credentials';
import {
  canonicalizeOrganizationRegistrationAuthorizationCredential,
} from 'gdc-common-utils-ts/utils/organization-registration-authorization';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';

type VerificationInput = Readonly<{
  credential: VerifiableCredentialV2;
  claims: Record<string, unknown>;
  controller?: Record<string, unknown>;
  organization?: Record<string, unknown>;
  controllerEmail?: string;
  cryptography: ICryptography;
  trustedIssuers: string[];
  fetchImpl?: typeof fetch;
  now?: Date;
}>;

export type HostAuthorizationVerificationResult = Readonly<{
  mode: 'host-authorization-vc';
  credentialId: string;
  issuer: string;
  signer: string;
  checks: Readonly<{
    trustedIssuer: true;
    signerCurrentlyControlsIssuer: true;
    signerMethodActive: true;
    detachedPqcProof: true;
    applicationBinding: true;
    postalDelivered: true;
  }>;
}>;

/**
 * Verifies the Test Network VC without calling ICA. The signer must still be a
 * currently published controller of the trusted issuer; removing either DID
 * relationship makes a later transaction fail closed.
 */
export async function verifyOrganizationRegistrationAuthorization(
  input: VerificationInput,
): Promise<HostAuthorizationVerificationResult> {
  const credential = input.credential;
  const issuer = typeof credential.issuer === 'string'
    ? credential.issuer
    : String((credential.issuer as { id?: string } | undefined)?.id || '');
  if (!credential.type.includes(ContractCredentialTypes.OrganizationRegistrationAuthorizationCredential)) {
    fail('Unexpected organization registration authorization credential type.');
  }
  if (!input.trustedIssuers.includes(issuer)) fail('Organization authorization issuer is not trusted.');
  const now = input.now || new Date();
  if (credential.validFrom && now < new Date(credential.validFrom)) fail('Organization authorization is not active yet.');
  if (credential.validUntil && now >= new Date(credential.validUntil)) fail('Organization authorization has expired.');

  const subject = credential.credentialSubject as Record<string, any>;
  if (subject.targetNetwork !== 'test-network') fail('Host authorization VC is restricted to Test Network.');
  if (subject.postalActivationLicense?.status !== 'delivered'
    || !subject.postalActivationLicense?.deliveredAt) {
    fail('Postal activation delivery is not confirmed.');
  }
  const organizationIdentifier = String(
    input.claims[ClaimsOrganizationSchemaorg.identifierValue]
      || input.claims[ClaimsOrganizationSchemaorg.taxId]
      || '',
  ).trim();
  if (!organizationIdentifier || subject.organization?.identifier !== organizationIdentifier) {
    fail('Authorization organization identifier does not match transaction claims.');
  }
  if (String(input.organization?.did || '') !== String(subject.id || '')) {
    fail('Authorization subject DID does not match the requested organization DID.');
  }
  if (String(input.controllerEmail || '').trim().toLowerCase()
    !== String(subject.controller?.email || '').trim().toLowerCase()) {
    fail('Authorization controller email does not match the transaction.');
  }
  const controllerJwk = input.controller?.publicKeyJwk as PublicJwk | undefined;
  if (!controllerJwk
    || toJwkThumbprintSha256Urn(controllerJwk) !== subject.controller?.hasCredential?.material) {
    fail('Authorization controller key does not match the transaction.');
  }

  const proofs = Array.isArray(credential.proof) ? credential.proof : credential.proof ? [credential.proof] : [];
  const proof = proofs.find(item => item.proofPurpose === 'contractAgreement' && item.jws && item.verificationMethod);
  if (!proof) fail('Organization authorization requires a contractAgreement proof.');
  const verificationMethod = String(proof.verificationMethod);
  const signerDid = verificationMethod.split('#')[0];
  const fetchImpl = input.fetchImpl || fetch;
  const [issuerDocument, signerDocument] = await Promise.all([
    resolveDidWebDocument(issuer, fetchImpl),
    resolveDidWebDocument(signerDid, fetchImpl),
  ]);
  const issuerControllers = Array.isArray(issuerDocument.controller)
    ? issuerDocument.controller
    : issuerDocument.controller ? [issuerDocument.controller] : [];
  if (!issuerControllers.includes(signerDid)) fail('Authorization signer is not a current issuer controller.');
  if ((signerDocument as any).deactivated === true || String((signerDocument as any).status || '') === 'revoked') {
    fail('Authorization signer is revoked.');
  }
  const method = (signerDocument.verificationMethod || []).find(item => item.id === verificationMethod);
  if (!method?.publicKeyJwk || !relationshipContains(signerDocument.assertionMethod, verificationMethod)) {
    fail('Authorization signer method is not an active assertion method.');
  }
  const header = JSON.parse(Buffer.from(String(proof.jws).split('.')[0] || '', 'base64url').toString('utf8'));
  if (header.alg !== 'ML-DSA-65') fail('Organization authorization requires ML-DSA-65.');
  const valid = await input.cryptography.verifyDetachedJws(
    new TextEncoder().encode(canonicalizeOrganizationRegistrationAuthorizationCredential(credential)),
    String(proof.jws),
    method.publicKeyJwk as PublicJwk,
  );
  if (!valid) fail('Organization authorization proof is invalid.');

  return {
    mode: 'host-authorization-vc',
    credentialId: String(credential.id || ''),
    issuer,
    signer: signerDid,
    checks: {
      trustedIssuer: true,
      signerCurrentlyControlsIssuer: true,
      signerMethodActive: true,
      detachedPqcProof: true,
      applicationBinding: true,
      postalDelivered: true,
    },
  };
}

function relationshipContains(
  relationship: Array<string | VerificationMethod> | undefined,
  methodId: string,
): boolean {
  return (relationship || []).some(item => typeof item === 'string' ? item === methodId : item.id === methodId);
}

async function resolveDidWebDocument(did: string, fetchImpl: typeof fetch): Promise<DidDocument> {
  if (!did.startsWith('did:web:')) fail('Authorization proof requires did:web identities.');
  const parts = did.slice('did:web:'.length).split(':');
  const domain = decodeURIComponent(parts.shift() || '');
  const url = parts.length > 0
    ? `https://${domain}/${parts.map(decodeURIComponent).join('/')}/did.json`
    : `https://${domain}/.well-known/did.json`;
  const response = await fetchImpl(url, { headers: { accept: 'application/did+json, application/json' } });
  if (!response.ok) fail(`Could not resolve authorization DID '${did}'.`);
  const document = await response.json() as DidDocument;
  if (document.id !== did) fail(`Resolved authorization DID does not match '${did}'.`);
  return document;
}

function fail(message: string): never {
  throw new ManagerError(message, IssueType.Security);
}
