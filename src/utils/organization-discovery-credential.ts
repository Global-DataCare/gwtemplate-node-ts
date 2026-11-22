import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ActivationCredentialTypes } from 'gdc-common-utils-ts/constants/verifiable-credentials';
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

/** Builds the host's own statement from its configured public legal identity. */
export function buildHostOrganizationStatement(entity?: {
  didDocument?: { id?: string };
  claims?: Record<string, unknown>;
  governanceVc?: VerifiableCredentialV2;
  selfDescriptionVc?: VerifiableCredentialV2;
}): VerifiableCredentialV2 | undefined {
  const issuer = entity?.didDocument?.id;
  const legalName = entity?.claims?.[ClaimsOrganizationSchemaorg.legalName];
  const identifier = entity?.claims?.[ClaimsOrganizationSchemaorg.identifierValue];
  const identifierType = entity?.claims?.[ClaimsOrganizationSchemaorg.identifierType];
  const configuredTaxId = entity?.claims?.[ClaimsOrganizationSchemaorg.taxId];
  if (!issuer || typeof legalName !== 'string' || !legalName.trim()
    || typeof identifier !== 'string' || !identifier.trim()) return undefined;

  const taxID = typeof configuredTaxId === 'string' && configuredTaxId.trim()
    ? configuredTaxId.trim()
    : typeof identifierType === 'string' && /^(TAX|VAT)$/i.test(identifierType) ? identifier.trim() : undefined;
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://schema.org'],
    id: `${issuer}#organization`,
    type: ['VerifiableCredential', ActivationCredentialTypes.OrganizationCredential],
    issuer,
    validFrom: getParticipantGaiaXCredential(entity)?.validFrom ?? new Date().toISOString(),
    credentialSubject: {
      id: issuer,
      '@type': 'Organization',
      legalName: legalName.trim(),
      identifier: {
        '@type': 'PropertyValue',
        value: identifier.trim(),
        ...(typeof identifierType === 'string' && identifierType.trim() ? { additionalType: identifierType.trim() } : {}),
      },
      ...(taxID ? { taxID } : {}),
    },
  };
}

/** Re-envelopes the original signed token without modifying its contents. */
export function readStoredParticipantJwt(credential: object | undefined) {
  const records = credential as { type?: unknown; id?: unknown; proof?: { type?: unknown; id?: unknown } } | undefined;
  const type = 'EnvelopedVerifiableCredential';
  const wrapper = records?.type === type ? records : records?.proof;
  if (wrapper?.type !== type || typeof wrapper.id !== 'string'
    || !/^data:application\/vc\+jwt,[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(wrapper.id)) return undefined;
  return { '@context': 'https://www.w3.org/ns/credentials/v2', type, id: wrapper.id };
}
