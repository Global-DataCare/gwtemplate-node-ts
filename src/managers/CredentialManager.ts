// src/managers/CredentialManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4 } from 'uuid';
import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { IKmsService } from '../crypto/interfaces/IKmsService';
import { EntityConfig } from '../models/entity';
import { ConfidentialStorageDoc } from '../models/confidential-storage';
import { ManagerError } from '../models/errors/manager-error';
import { IssueType } from '../models/fhir/codes';
import { VerifiableCredentialV2 } from '../models/verifiable-credential';
import { objectToBytes } from '../utils/object-convert';
import { MldsaPublicJwk } from '../crypto/interfaces/Cryptography.types';
import { getTenantVaultId } from '../utils/tenant';
import { TenantsCacheManager } from './TenantsCacheManager';import { determineResourceId } from '../utils/resource';

/**
 * Manages the business logic for creating and verifying Verifiable Credentials.
 */
export class CredentialManager {
  private vaultRepository: VaultRepository;
  private kmsService: IKmsService;
  private hostDid: string;

  constructor(
    vaultRepository: VaultRepository,
    kmsService: IKmsService,
    hostDid: string,
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.hostDid = hostDid;
  }

  /**
   * Searches for and decrypts a Verifiable Credential for a given subject URN and resource type.
   * @param tenant The tenant configuration object in which context to search.
   * @param subjectUrn The unique URN of the credential's subject (e.g., a tenant, an employee).
   * @param resourceType The type of resource (e.g., 'Organization', 'EmployeeRole').
   * @returns A promise that resolves to the decrypted VerifiableCredential.
   */
  public async search(tenant: EntityConfig, subjectUrn: string, resourceType: string): Promise<VerifiableCredentialV2> {
    const vaultId = getTenantVaultId(tenant.sector, tenant.alternateName);
    const collectionId = `credential.${resourceType}`;
    
    // For organization credentials, the docId is a constant. For others, it's a derived unique ID from the URN.
    const docId = resourceType === 'Organization' ? 'self-description' : determineResourceId(subjectUrn);
    
    // For the organization's own VC, the entityId for decryption is the vaultId itself.
    // For other entities like employees, it would be their specific URN/DID.
    const decryptionEntityId = resourceType === 'Organization' ? vaultId : subjectUrn;

    const encryptedDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(vaultId, collectionId, docId);

    if (!encryptedDoc) {
      throw new ManagerError(
        `Credential for subject '${docId}' of type '${resourceType}' not found.`,
        IssueType.NotFound,
      );
    }

    const decryptedVc = await this.kmsService.unprotectConfidentialData<VerifiableCredentialV2>(encryptedDoc, decryptionEntityId);
    return decryptedVc;
  }

  /**
   * Issues a signed Self-Description Verifiable Credential for a given tenant.
   * @param vaultId The internal vault ID of the tenant (e.g., 'health-care_acme').
   * @returns A promise that resolves to the complete, signed VerifiableCredential object.
   */
  public async issueOrganizationSelfDescription(vaultId: string): Promise<VerifiableCredentialV2> {
    // 1. Fetch and decrypt tenant data
    const encryptedDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(vaultId, 'tenants');
    if (!encryptedDoc) {
      throw new ManagerError(`Tenant with vaultId '${vaultId}' not found in repository.`, IssueType.NotFound);
    }
    const tenantConfig = await this.kmsService.unprotectConfidentialData<EntityConfig>(encryptedDoc, 'host');

    // 2. Construct the Credential Subject from the tenant's public claims
    const credentialSubject: Record<string, any> = {
      id: tenantConfig.identifier, // The tenant's stable URN identifier
      legalName: tenantConfig.legalName,
      jurisdiction: tenantConfig.jurisdiction,
      // Create the structured identifier as discussed
      identifier: [{
        type: 'TAX',
        id: tenantConfig.taxId, // Assuming taxId is a property on TenantConfig
        scheme: 'VATES', // This might need to be dynamic based on jurisdiction
      }],
    };

    // 3. Build the unsigned VC object
    const now = new Date();
    const oneYearFromNow = new Date(now.getTime());
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    const unsignedVc: VerifiableCredentialV2 = {
      '@context': [
        'https://www.w3.org/2018/credentials/v1',
        'https://schema.org/', // Add schema.org context for fields like 'legalName'
      ],
      id: `urn:uuid:${uuidv4()}`, // Unique ID for the credential itself
      type: ['VerifiableCredential', 'Organization'],
      issuer: this.hostDid,
      validFrom: now.toISOString(),
      validUntil: oneYearFromNow.toISOString(),
      credentialSubject: credentialSubject,
    };

    // 4. Sign the payload
    // The `host` (vaultId) is always the signer for tenant credentials.
    const signatureResult = await this.kmsService.signWithManagedKey(objectToBytes(unsignedVc), 'host');

    // 5. Construct the final VC with the proof
    // TODO: try-catch as the signerJWKey could be undefined
    const signerJWKey = await this.kmsService.getPublicVerificationKey('host');
    
    // The JWS is constructed in detached format (header..signature)
    const jws = `${signatureResult.signatures[0].protected}..${signatureResult.signatures[0].signature}`;

    const signedVc: VerifiableCredentialV2 = {
      ...unsignedVc,
      proof: {
        type: 'JsonWebSignature2020',
        proofPurpose: 'assertionMethod',
        // As discussed, the verification method is the issuer's DID + the key ID
        verificationMethod: `${this.hostDid}#${(signerJWKey as MldsaPublicJwk).kid}`,
        created: now.toISOString(),
        jws: jws,
      },
    };

    return signedVc;
  }
}
