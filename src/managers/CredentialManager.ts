// src/managers/CredentialManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { IKmsService } from '../crypto/interfaces/IKmsService';
import { VerifiableCredentialV2, ProofEBSIv2 } from '../models/verifiable-credential';
import { ManagerError } from '../models/errors/manager-error';
import { objectToBytes } from '../utils/object-convert';
import { IServerConfig } from '../config';
import { TenantsCacheManager } from './TenantsCacheManager';
import { ConfidentialStorageDoc } from '../models/confidential-storage';
import { IssueType } from '../models/fhir/codes';
import { generateVcId } from '../utils/vc-id';
import { MldsaPublicJwk } from '../crypto/interfaces/Cryptography.types';
import { ClaimsRecord } from '../models/resource-document';
import { ParameterData } from '../models/params';
import { parseValidityPeriod } from '../utils/time';

/**
 * A low-level cryptographic engine responsible for the mechanics of creating,
 * signing, and storing Verifiable Credentials. It is invoked by higher-level
 * business managers (like HostingManager or EmployeeManager) after they have
 * validated the business logic and evidence. This manager throws exceptions on failure.
 */
export class CredentialManager {
  private vaultRepository: VaultRepository;
  private kmsService: IKmsService;
  private tenantsCacheManager: TenantsCacheManager;
  private config: IServerConfig;
  private hostDid: string;

  constructor(
    vaultRepository: VaultRepository,
    kmsService: IKmsService,
    tenantsCacheManager: TenantsCacheManager,
    config: IServerConfig,
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
    this.config = config;
    this.hostDid = `did:web:${config.hostExternalDomain}`;
  }

  /**
   * Issues a signed Self-Description Verifiable Credential for a tenant organization.
   * This is a wrapper around the core createAndSignVc function.
   */
  public async issueOrganizationSelfDescription(
    tenantUrn: string,
    validatedClaims: ClaimsRecord,
    evidence: any,
  ): Promise<VerifiableCredentialV2> {
    return this.createAndSignVc(
      this.hostDid,
      'host',
      tenantUrn,
      ['VerifiableCredential', 'Organization'],
      validatedClaims,
      evidence,
      '1y',
    );
  }

  /**
   * Issues a signed Verifiable Credential for a new employee.
   * This is a wrapper around the core createAndSignVc function.
   */
  public async issueEmployeeCredential(
    jobContext: { tenantId: string; tenantVaultId: string },
    employeeUrn: string,
    validatedClaims: ClaimsRecord,
    evidence: any,
  ): Promise<VerifiableCredentialV2> {
    const issuerUrn = this.tenantsCacheManager.getTenantIdentifierUrn(jobContext.tenantId);
    if (!issuerUrn) {
      throw new ManagerError(`Could not resolve URN for tenant '${jobContext.tenantId}'.`, IssueType.NotFound);
    }
    return this.createAndSignVc(
      issuerUrn,
      jobContext.tenantVaultId,
      employeeUrn,
      ['VerifiableCredential', 'Employee'],
      validatedClaims,
      evidence,
      '1y',
    );
  }

  /**
   * Protects (encrypts) and stores a Verifiable Credential in the appropriate vault.
   */
  public async storeCredential(
    vc: VerifiableCredentialV2,
    vaultId: string,
    collectionId: string,
    subjectUrn: string,
    decryptionEntityId: string,
  ): Promise<void> {
    const indexIdentifier: ParameterData = {
      name: 'identifier',
      value: subjectUrn,
      unique: true,
      type: 'uri', // URNs are a type of URI
    };
    
    // First, protect the indexed attributes to generate HMACs
    const protectedIndexes = await this.kmsService.protectAttributesNameAndValue([indexIdentifier], vaultId);

    const docToProtect: ConfidentialStorageDoc = {
      sequence: 0,
      id: vc.id as string,
      content: vc,
      indexed: { attributes: protectedIndexes },
    };

    // Now, protect the full document content (encryption)
    const protectedDoc = await this.kmsService.protectConfidentialData(docToProtect, decryptionEntityId);
    
    await this.vaultRepository.put(vaultId, [protectedDoc], collectionId);
  }

  /**
   * Searches for a credential by its subject's URN, decrypts it, and returns it.
   */
  public async searchCredential(
    tenantVaultId: string,
    subjectUrn: string,
    collectionId: string,
    decryptionEntityId: string,
  ): Promise<VerifiableCredentialV2 | null> {
    // 1. Construct a query to find the document by its index.
    // The repository implementation is responsible for using the KMS to hash the 
    // `equals` value before performing the search.
    const query = {
      sectionId: collectionId,
      where: [{ attribute: 'identifier', equals: subjectUrn }],
    };
    
    const encryptedDocs = await this.vaultRepository.query(tenantVaultId, query);

    if (!encryptedDocs || encryptedDocs.length === 0) {
      return null;
    }

    // 2. Unprotect (decrypt) the document content
    const decryptedVc = await this.kmsService.unprotectConfidentialData<VerifiableCredentialV2>(
      encryptedDocs[0],
      decryptionEntityId,
    );

    return decryptedVc;
  }


  /**
   * The core private issuance function. Creates, canonicalizes, and signs any VC.
   */
  private async createAndSignVc(
    issuer: string,
    signerEntityId: string,
    subjectIdentifier: string,
    type: string[],
    claims?: Record<string, any>,
    evidence?: any,
    validPeriod: string = '1y',
  ): Promise<VerifiableCredentialV2> {
    const now = new Date();
    const expirationDate = parseValidityPeriod(validPeriod, now);

    // Per the W3C VC spec and internal standards, 'credentialSubject.identifier' holds the
    // stable, public URN for the subject. 'id' is reserved for internal or context-specific use.
    const credentialSubject = {
      ...(claims || {}),
      identifier: subjectIdentifier,
    };

    const unsignedVc: VerifiableCredentialV2 = {
      '@context': ['https://www.w3.org/2018/credentials/v1', 'https://schema.org/'],
      id: 'urn:placeholder', // Placeholder, will be replaced by the deterministic ID
      type: type,
      issuer: issuer,
      validFrom: now.toISOString(),
      validUntil: expirationDate.toISOString(),
      credentialSubject: credentialSubject,
      evidence: evidence ? [evidence] : undefined,
    };

    // Generate the deterministic, versioned ID from the subject's public identifier and issuance date.
    unsignedVc.id = generateVcId(unsignedVc.credentialSubject.identifier as string, unsignedVc.validFrom as string);

    const signatureResult = await this.kmsService.signWithManagedKey(objectToBytes(unsignedVc), signerEntityId);
    const signingKey = await this.kmsService.getPublicVerificationKey(signerEntityId);
    if (!signingKey) {
      throw new ManagerError(`Could not retrieve public key for signer '${signerEntityId}'.`, IssueType.NotFound);
    }
    
    const jws = `${signatureResult.signatures[0].protected}..${signatureResult.signatures[0].signature}`;

    const proof: ProofEBSIv2 = {
      type: 'JsonWebSignature2020',
      proofPurpose: 'assertionMethod',
      verificationMethod: `${issuer}#${(signingKey as MldsaPublicJwk).kid}`,
      created: now.toISOString(),
      jws: jws,
    };

    // Adhering to the documented internal standard: proof is ALWAYS an array.
    return { ...unsignedVc, proof: [proof] };
  }
}


