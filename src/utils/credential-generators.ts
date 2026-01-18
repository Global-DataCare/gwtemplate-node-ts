import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';

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
}
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

  const credentialId = `urn:uuid:${uuidv4()}`;

  return {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://w3id.org/gaia-x/context/v2206"
    ],
    "id": credentialId,
    "type": ["VerifiableCredential", "gx:LegalParticipant"],
    "issuer": issuerDid,
    "validFrom": new Date().toISOString(),
    "credentialSubject": {
      "id": did,
      "type": "gx:LegalParticipant",
      "gx:legalName": officialName,
      "gx:legalRegistrationNumber": {
        "type": "gx:RegistrationNumber",
        "gx:vatID": vatId
      },
      "gx:headquarterAddress": {
        "type": "gx:Address",
        "gx:countryCode": countryCode
      },
      "gx:legalAddress": {
        "type": "gx:Address",
        "gx:countryCode": countryCode
      },
      "gx:website": webDomain,
      "gx:termsAndConditions": {
        "type": "gx:TermsAndConditions",
        "gx:content": termsAndConditionsUrl,
        "gx:hash": {
          "gx:algorithm": termsAndConditionsHashAlg,
          "gx:value": termsAndConditionsHashHex
        }
      }
    }
    // Note: add the "proof" property after signing with a compatible tool.
  };
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

  if (!officialName || !vatId || !countryCode || !termsAndConditionsUrl) {
    throw new Error('Missing required claims to build Gaia-X Legal Participant credential.');
  }

  const termsAndConditionsHashHex = termsHashClaim
    ? termsHashClaim
    : createHash('sha384').update(termsAndConditionsUrl).digest('hex');

  return {
    webDomain,
    officialName,
    did,
    issuerDid,
    vatId,
    countryCode,
    termsAndConditionsUrl,
    termsAndConditionsHashHex,
    termsAndConditionsHashAlg: 'SHA-384',
  };
}
