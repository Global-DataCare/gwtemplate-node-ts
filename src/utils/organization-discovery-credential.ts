import type { VerifiableCredentialV2 } from 'gdc-common-utils-ts/models/verifiable-credential';

/** Selects the original organization VC from records already admitted by the gateway. */
export function isIssuedOrganizationCredential(value?: VerifiableCredentialV2): value is VerifiableCredentialV2 {
  if (!value || !Array.isArray(value.type) || !value.type.includes('OrganizationCredential')
    || !Array.isArray(value['@context']) || !value['@context'].includes('https://schema.org')) return false;
  const subject = value.credentialSubject;
  const proofs = Array.isArray(value.proof) ? value.proof : [value.proof];
  return subject?.['@type'] === 'Organization' && typeof subject.id === 'string'
    && typeof value.issuer === 'string' && Boolean(value.issuer) && value.issuer !== subject.id
    && proofs.some(proof => proof?.verificationMethod?.startsWith(`${value.issuer}#`)
      && Boolean(proof.jws || ('proofValue' in proof && typeof proof.proofValue === 'string' && proof.proofValue)));
}


/** The participant signs its own declaration. Never use an ICA organization VC as a JWT payload here. */
export function getParticipantGaiaXCredential(entity?: {
  didDocument?: { id?: string };
  governanceVc?: VerifiableCredentialV2;
  selfDescriptionVc?: VerifiableCredentialV2;
}): VerifiableCredentialV2 | undefined {
  const participant = entity?.didDocument?.id;
  return [entity?.governanceVc, entity?.selfDescriptionVc].find(credential => (
    Boolean(participant) && credential?.issuer === participant
      && credential?.credentialSubject?.id === participant
      && (credential?.credentialSubject?.type ?? credential?.credentialSubject?.['@type']) === 'gx:LegalPerson'
  ));
}
