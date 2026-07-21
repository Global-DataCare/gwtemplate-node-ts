import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { buildGaiaXLegalPersonCredentialDraft } from 'gdc-common-utils-ts/convert/schemaorg-to-gaia-x';

export interface GaiaXLegalParticipantCredentialOptions {
  webDomain: string;              // e.g. "https://example.com"
  officialName: string;           // legal name
  did: string;                    // DID of the participant (subject)
  issuerDid: string;              // DID of the issuer/signing entity
  vatId: string;                  // e.g. "ESB12345678"
  countryCode: string;            // ISO 3166-1 alpha-2, e.g. "ES"
  termsAndConditionsUrl: string;  // public URL
  termsAndConditionsHashHex: string; // hex string of the T&C file hash
  termsAndConditionsHashAlg?: "SHA-256" | "SHA-384" | "SHA-512";
  /** Resolvable ICA/GXDCH registration credential. GDC deployments may point to ICA evidence until GXDCH replacement. */
  legalRegistrationNumberCredentialId?: string;
}
/**
 * @deprecated Compatibility name. The returned ICAM 25.11 credential is a
 * Gaia-X `LegalPerson`, meaning the participating legal organization, never
 * the natural-person LegalRepresentative.
 */
export function createGaiaXLegalParticipantCredential(options: GaiaXLegalParticipantCredentialOptions) {
  const {
    webDomain,
    officialName,
    did,
    issuerDid,
    vatId,
    countryCode,
    termsAndConditionsUrl,
    termsAndConditionsHashHex,
    termsAndConditionsHashAlg = "SHA-384",
  } = options;

  const claims: ClaimsRecord = {
    [ClaimsOrganizationSchemaorg.legalName]: officialName,
    [ClaimsOrganizationSchemaorg.identifierValue]: vatId,
    [ClaimsOrganizationSchemaorg.addressCountry]: countryCode,
    [ClaimsOrganizationSchemaorg.url]: webDomain,
  };
  return buildGaiaXLegalPersonCredentialDraft({
    claims,
    credentialId: `urn:uuid:${uuidv4()}`,
    subjectId: did,
    issuerId: issuerDid,
    legalRegistrationNumberCredentialId:
      options.legalRegistrationNumberCredentialId || `${did}#ica-legal-registration-evidence`,
    validFrom: new Date().toISOString(),
  });
}

export function buildGaiaXLegalParticipantOptionsFromClaims(params: {
  claims: ClaimsRecord;
  webDomain: string;
  did: string;
  issuerDid: string;
}): GaiaXLegalParticipantCredentialOptions {
  const { claims, webDomain, did, issuerDid } = params;
  const officialName = claims[ClaimsOrganizationSchemaorg.legalName] as string | undefined;
  const vatId = claims[ClaimsOrganizationSchemaorg.identifierValue] as string | undefined;
  const countryCode = claims[ClaimsOrganizationSchemaorg.addressCountry] as string | undefined;
  const termsAndConditionsUrl = claims[ClaimsServiceSchemaorg.termsOfService] as string | undefined;
  const termsHashClaim = claims[`${ClaimsServiceSchemaorg.termsOfService}#hash`] as string | undefined;

  if (!officialName || !vatId || !countryCode) {
    throw new Error('Missing required claims to build Gaia-X Legal Participant credential.');
  }

  const normalizedTermsUrl = termsAndConditionsUrl || (
    ['demo', 'test', 'development'].includes(process.env.NODE_ENV || '')
      ? 'https://example.org/terms'
      : undefined
  );
  if (!normalizedTermsUrl) {
    throw new Error('Missing required claims to build Gaia-X Legal Participant credential.');
  }

  const termsAndConditionsHashHex = termsHashClaim
    ? termsHashClaim
    : createHash('sha384').update(normalizedTermsUrl).digest('hex');

  return {
    webDomain,
    officialName,
    did,
    issuerDid,
    vatId,
    countryCode,
    termsAndConditionsUrl: normalizedTermsUrl,
    termsAndConditionsHashHex,
    termsAndConditionsHashAlg: 'SHA-384',
  };
}
