// src/models/oidc4ida.electronicRecord.model.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { AttachmentExternalDLT, CheckDetails, VerifierDLT } from './oidc4ida.common.model';

// TODO: IssuerElectronicRecordOpenID with personal_number

/** OpenID 'electronic_record' evidence sub-element base data
 *  to be extended with 'attachments' and 'record' elements for blockchain or OpenID Evidence of Electronic Record
 *  The electronic health record can be about a VC, SHC, DGC, FHIR Bundle or single resource (e.g.: a single medical record).
 *  - 'type': always 'electronic_record.
 *  - 'check_details': OPTIONAL. Checks done in relation to the evidence. https://bitbucket.org/openid/ekyc-ida/wiki/identifiers
 *  - 'verifier': legal entity that performed the identity verification on behalf of the OP (OpenID Provider)
 *  - 'time': Time stamp in ISO 8601:2004 format representing the date when it was verified.
 */
export interface EvidenceElectronicRecordBase {
    check_details?: CheckDetails[];      // OPTIONAL. Checks done in relation to the evidence. https://bitbucket.org/openid/ekyc-ida/wiki/identifiers
    time?:          string;                   // OPTIONAL. Time stamp in ISO 8601:2004 [ISO8601-2004] YYYY-MM-DDThh:mm[:ss]TZD format representing the date when it was verified
    type?:          'electronic_record';      // REQUIRED but not stored on blockchain in case of FHIR resources (they always are 'electronic_records').
    verifier?:      VerifierDLT;              // OPTIONAL. A JSON object denoting the legal entity that performed the identity verification on behalf of the OP.
}

/** OpenID 'electronic_record' evidence sub-element for blockchain.
 *  The electronic health record can be about a VC, SHC, DGC, FHIR Bundle or single resource (e.g.: a single medical record).
 *  - 'record': 'source' (issuer), 'personal_number' (subject's DID), 'created_at', 'date_of_expiry', 'type' ('idcard' or 'vc', 'shc', 'dgc', 'fhir', etc: see 'Electronic Records' at https://bitbucket.org/openid/ekyc-ida/wiki/identifiers)
 *  - 'attachments': only external attachments are allowed for blockchain certification (no inline data)
 *  - 'type': always 'electronic_record.
 *  - 'validation_method': how the authenticity of the document was determined.
 *  - 'verification_method': how the user was proven to be the owner of the claims.
 *  - 'verifier': legal entity that performed the identity verification on behalf of the OP (OpenID Provider)
 *  - 'time': Time stamp in ISO 8601:2004 format representing the date when it was verified.
 *
 *  NOTE: 'document_details' is not for electronic records (use 'record' instead).
 */
export interface EvidenceElectronicRecordDLT extends
    EvidenceElectronicRecordBase    // 'type', 'validation_method', 'verification_method', 'verifier', 'time'
{
    attachments?:   AttachmentExternalDLT[];  // OPTIONAL. Array of JSON objects representing attachments like photocopies of documents or certificates.
    record?:        ElectronicRecordDLT;      // JSON object representing the id document used to perform the id verification
}

/** OpenID 'electronic_record' evidence sub-element can be about an ID card, VC, SHC, DGC, etc.
 *  - 'type': can be 'idcard', 'vc', 'shc', 'dgc', 'fhir', etc (see 'Electronic Records' at https://bitbucket.org/openid/ekyc-ida/wiki/identifiers)
 *  - 'created_at': is the same as 'validFrom' property in a W3C credential.
 *  - 'date_of_expiry': it the same as 'validUntil' in a W3C credential.
 *  - 'personal_number' is the subject's DID URI, similar to 'holder.id' property in a W3C credential.
 *
 *  NOTE: 'personal_number' (subject DID URI) is not excluded for now?
 */
export interface ElectronicRecordBase {
    type:               string;             // REQUIRED. string;denoting the type of electronic record. See https://bitbucket.org/openid/ekyc-ida/wiki/identifiers
    created_at?:        string;             // OPTIONAL. The time the record was created as ISO 8601:2004 [ISO8601-2004] YYYY-MM-DDThh:mm[:ss]TZD format    date_of_expiry?:    string; // REQUIRED. If this attribute exists for the particular type of document. The date the document will expire as ISO 8601:2004 YYYY-MM-DD format.
    date_of_expiry?:    string;             // OPTIONAL. The date the evidence will expire as ISO 8601:2004 [ISO8601-2004] YYYY-MM-DD format.
    source?:            IssuerElectronicRecordBase; // OPTIONAL. Issuer as source of the record (can have jurisdiction and )
    // personal_number?:   string;                     // OPTIONAL. Subject DID URI (it can be also the holder ID).
}

/** OpenID 'electronic_record' evidence sub-element can be about a VC, SHC of DGC.
 *  - 'type': String denoting the type of electronic record. It can be a predefined value (idcard, etc) or 'vc', 'shc', 'dgc', 'fhir', etc (see 'Electronic Records' at https://bitbucket.org/openid/ekyc-ida/wiki/identifiers)
 *  - 'created_at' is the issued property.
 *  - 'date_of_expiry' it the periodEnd.
 *  NOTE:
 *  - 'personal_number' (subject DID) is excluded for now? (it is also the same as the 'holder.id' property in VC).
 */
export interface ElectronicRecordDLT extends
    ElectronicRecordBase    // 'type', 'personal_number', 'created_at', 'date_of_expiry'
{
    source?: IssuerElectronicRecordDLT; // OPTIONAL. Issuer as source of the record (API can set the name and jurisdiction for the OpenID source element)
}

/** Issuer's anonymized information (can be used for research purposes) */
export interface IssuerElectronicRecordBase {
    country_code?:  string; // ISO 3166/ICAO 3-letter codes [ICAO-Doc9303]. 2-letter ISO 3166/ICAO codes MAY be used in some circumstances for compatibility reasons.
    jurisdiction?:  string; // ISO: String containing the region(s) / state(s) / province(s) / municipality(ies) that source has jurisdiction over
    // postal_code?:string; // Zip code or postal code component.
}

/** It replaces the issuer 'name' by 'id' and 'type' (for blockchain)
 *  and also includes 'country' and 'region' (but not 'postal_code', 'locality' or 'stree_address').
 */
export interface IssuerElectronicRecordDLT extends
    IssuerElectronicRecordBase
{
    id?:            string; // custom UHC property instead of 'name'
    type?:          string; // custom UHC property
}