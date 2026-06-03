// src/managers/EmployeeManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4 } from 'uuid';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { determineResourceId } from '../utils/resource';
import { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { initializeEmployeeServices } from '../utils/services';
import { createOperationOutcome } from '../utils/outcome';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { TenantsCacheManager } from './TenantsCacheManager';
import { getTenantVaultId } from '../utils/tenant';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { BundleEntry, ErrorEntry, BundleEntryRequest, BundleJsonApi } from 'gdc-common-utils-ts/models/bundle';
import { ClaimsRecord, RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { normalizeCodeSystemAndValue } from '../utils/normalize-codeAndSystem';
import { ParameterData } from 'gdc-common-utils-ts/models/params';
import { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { DidDocument, VerificationMethod } from '../gdc-backend-utils-node/models/did';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { EntityLifecycleStatus, EntityType } from '../gdc-backend-utils-node/models/enums';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { generateLicenseOffer } from '../utils/offer';
import { getEnvSectionId } from '../utils/section-env';
import { getPersonOccupationClaim } from '../utils/occupation';
import { createEmployeeUrn, parseTenantUrn } from '../utils/urn';
import { normalizeIndexedEmail } from '../utils/indexed-contact';
import {
  ACTION_PURGE,
  LICENSE_STATUS_AVAILABLE,
  LICENSE_STATUS_ISSUED,
  LICENSE_TYPE_MOBILE,
  LICENSE_USER_CLASS_EMPLOYEE,
} from '../constants/domain';

const EMPLOYEE_SECTION = getEnvSectionId('employees');
const DEVICE_LICENSE_SECTION = getEnvSectionId('device-licenses');

export class EmployeeManager {
  private vaultRepository: IVaultRepository;
  private kmsService: IKmsService;
  private tenantsCacheManager: TenantsCacheManager;

  constructor(
    vaultRepository: IVaultRepository,
    kmsService: IKmsService,
    tenantsCacheManager: TenantsCacheManager,
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
  }

  public async process(job: JobRequest, environment?: string): Promise<IDecodedDidcommPayload> {
    if (!job.content) {
      throw new ManagerError('Job content is missing', IssueType.Required);
    }
    const body = job.content.body as any;
    const entries = body?.data ?? [];

    if (!job.tenantId || !job.sector) {
      throw new ManagerError('Job is missing required tenantId or sector.', IssueType.Required);
    }
    const vaultId = getTenantVaultId(job.sector, job.tenantId);

    // Fetch the tenant's URN once for the entire job.
    const issuerUrn = await this.tenantsCacheManager.getTenantIdentifierUrn(vaultId);
    if (!issuerUrn) {
      throw new ManagerError(`Tenant with ID '${job.tenantId}' not found.`, IssueType.NotFound);
    }

    if (!job.content.meta) {
      // This should ideally never happen if the request passed through the security layer.
      throw new ManagerError('Job is missing cryptographic metadata.', IssueType.Invalid);
    }

    if (job.action === '_search') {
      return this.processSearch(job, vaultId, issuerUrn);
    }

    const responseEntries: (BundleEntry | ErrorEntry)[] = [];

    for (const entry of entries) {
      try {
        // Pass the fetched URN and the job metadata down to the entry processor.
        const resultEntry = await this.processEntry(
          entry,
          job.action,
          vaultId,
          issuerUrn,
          job.content.meta,
          job.contentType,
          environment,
          job.sector,
          job.jurisdiction,
        );
        responseEntries.push(resultEntry);
      } catch (error: any) {
        const errorEntry = this.handleError(error, entry.type, (entry as BundleEntryRequest).meta);
        responseEntries.push(errorEntry);
      }
    }

    const responseBundle: BundleJsonApi = {
      data: responseEntries,
      resourceType: 'Bundle',
      total: responseEntries.length,
      type: getBundleResponseTypeForAction(job.action),
    };

    const result: IDecodedDidcommPayload = {
      jti: uuidv4(),
      thid: job.content.thid as string,
      iss: issuerUrn, // Use the tenant's URN as the issuer
      aud: job.content.aud as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'batch-response',
      body: responseBundle,
    };
    return result;
  }

  private async processSearch(
    job: JobRequest,
    vaultId: string,
    issuerUrn: string,
  ): Promise<IDecodedDidcommPayload> {
    const body = job.content?.body as any;
    const entries = Array.isArray(body?.entry) ? body.entry : [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];

    if (entries.length === 0) {
      throw new ManagerError('Employee search requires at least one Bundle.entry request.', IssueType.Required);
    }

    for (const entry of entries) {
      try {
        responseEntries.push(await this.processSearchEntry(vaultId, entry));
      } catch (error: any) {
        responseEntries.push(this.handleError(error, 'Employee-search-response-v1.0', entry?.meta));
      }
    }

    return {
      jti: uuidv4(),
      thid: job.content?.thid as string,
      iss: issuerUrn,
      aud: job.content?.aud as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'search-response',
      body: {
        data: responseEntries,
        resourceType: 'Bundle',
        total: responseEntries.length,
        type: getBundleResponseTypeForAction(job.action),
      },
    };
  }

  private async processSearchEntry(vaultId: string, entry: any): Promise<BundleEntry> {
    const request = entry?.request;
    if (!request) {
      throw new ManagerError('Employee search entry requires a request object.', IssueType.Required);
    }
    if (String(request.method || '').toUpperCase() !== 'GET') {
      throw new ManagerError('Employee search only supports GET entry requests.', IssueType.NotSupported);
    }

    const filters = this.extractSearchFilters(request.url);
    const matches = await this.searchEmployees(vaultId, filters);

    return {
      type: 'Employee-search-response-v1.0',
      resource: {
        total: matches.length,
        data: matches,
      } as any,
      response: { status: '200' },
    };
  }

  private extractSearchFilters(requestUrl: unknown): Record<string, string[]> {
    const rawUrl = String(requestUrl || '').trim();
    const [resourceName, queryString = ''] = rawUrl.split('?');
    if (resourceName && resourceName !== 'Employee') {
      throw new ManagerError(`Employee search expects request.url to target 'Employee', got '${resourceName}'.`, IssueType.Invalid);
    }

    const params = new URLSearchParams(queryString);
    const filters: Record<string, string[]> = {};
    for (const [key, value] of params.entries()) {
      const values = String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      if (values.length > 0) {
        filters[key] = values;
      }
    }
    return filters;
  }

  private async searchEmployees(
    vaultId: string,
    filters: Record<string, string[]>,
  ): Promise<Array<Record<string, unknown>>> {
    const docs =
      (await this.vaultRepository.getContainersInSection<any>(vaultId, EMPLOYEE_SECTION)) || [];
    const matches: Array<Record<string, unknown>> = [];

    for (const doc of docs) {
      if (!doc?.content && !doc?.jwe) continue;
      try {
        const employee = await this.kmsService.unprotectConfidentialData<EntityConfig>(doc, vaultId);
        if (!employee?.claims || employee.type !== EntityType.Person) continue;
        if (!this.matchesEmployeeFilters(employee, filters)) continue;

        matches.push({
          id: employee.id,
          status: employee.status,
          claims: employee.claims,
          meta: employee.meta,
        });
      } catch {
        continue;
      }
    }

    return matches;
  }

  private matchesEmployeeFilters(
    employee: EntityConfig,
    filters: Record<string, string[]>,
  ): boolean {
    const claims = (employee.claims || {}) as ClaimsRecord;
    const entries = Object.entries(filters);
    if (entries.length === 0) return true;

    return entries.every(([key, expectedValues]) => {
      const actualValue = this.resolveEmployeeSearchValue(claims, key);
      if (!actualValue) return false;
      return expectedValues.includes(actualValue);
    });
  }

  private resolveEmployeeSearchValue(claims: ClaimsRecord, key: string): string | undefined {
    if (key === ClaimsPersonSchemaorg.hasOccupation || key === ClaimsPersonSchemaorg.hasOccupationalRoleValue) {
      return getPersonOccupationClaim(claims) || undefined;
    }

    const rawValue = claims[key];
    if (rawValue === undefined || rawValue === null) return undefined;
    return String(rawValue).trim() || undefined;
  }

  private async processEntry(
    entry: BundleEntry,
    action: string | undefined,
    vaultId: string,
    tenantUrn: string,
    meta: IDecodedDidcommPayload['meta'],
    contentType?: string,
    environment?: string,
    sector?: string,
    jurisdiction?: string,
  ): Promise<BundleEntry> {
    const requestEntry = entry as BundleEntryRequest;
    const { request, meta: entryMeta, type } = requestEntry;
    const claims = entryMeta?.claims;

    if (!request || !claims) {
      throw new ManagerError('Entry requires a request object and meta.claims.', IssueType.Required);
    }

    const identifierClaim = claims[ClaimsPersonSchemaorg.identifier];
    if (!identifierClaim) {
      throw new ManagerError('Missing identifier claim for operation on Employee.', IssueType.Required);
    }
    const employeeId = determineResourceId(identifierClaim, environment);

    switch (request.method) {
      case 'POST':
        if (action === ACTION_PURGE) {
          return this.purgeEmployee(vaultId, employeeId, claims, type);
        }
        return this.createEmployee(vaultId, tenantUrn, employeeId, claims, type, meta, contentType, sector, jurisdiction);
      case 'DELETE':
        return this.disableEmployee(vaultId, employeeId, type);
      default:
        throw new ManagerError(`Unsupported request method: '${request.method}'`, IssueType.NotSupported);
    }
  }

  private async createEmployee(
    vaultId: string,
    tenantUrn: string,
    employeeId: string,
    claims: ClaimsRecord,
    entryType: string,
    jobMeta: IDecodedDidcommPayload['meta'],
    contentType?: string,
    sector?: string,
    jurisdiction?: string,
  ): Promise<BundleEntry> {
    let signerJwk: PublicJwk | undefined;
    let encrypterJwk: PublicJwk | undefined;

    const email = normalizeIndexedEmail(claims[ClaimsPersonSchemaorg.email]);
    if (!email) {
      throw new ManagerError('Missing or invalid email claim.', IssueType.Required);
    }

    const roleCode = getPersonOccupationClaim(claims); // canonical: hasOccupation.identifier.value (+ optional system)
    if (!roleCode) {
      throw new ManagerError('Missing or invalid hasOccupation claim.', IssueType.Required);
    }

    const existingEmployee = await this.findEmployeeByEmailAndRole(vaultId, email, roleCode);
    if (existingEmployee) {
      return this.upsertExistingEmployee(existingEmployee, vaultId, claims, entryType);
    }

    const parsedTenantUrn = parseTenantUrn(tenantUrn);
    if (!parsedTenantUrn) {
      throw new ManagerError(`Invalid tenant URN format: '${tenantUrn}'`, IssueType.Value);
    }
    const employeeUrnForKeys = createEmployeeUrn({
      namespace: parsedTenantUrn.namespace,
      network: parsedTenantUrn.network,
      jurisdiction: parsedTenantUrn.jurisdiction,
      version: parsedTenantUrn.version,
      sector: parsedTenantUrn.sector,
      idType: parsedTenantUrn.idType,
      idValue: parsedTenantUrn.idValue,
      email,
      role: roleCode,
    });

    const licenseOffer = await this.tryConsumeEmployeeSeatOrOffer({
      vaultId,
      employeeId,
      sector: sector || 'health-care',
      jurisdiction: jurisdiction || 'us',
    });
    if (licenseOffer) return licenseOffer;

    // The flow for obtaining the employee's public keys depends on the request type.
    if (contentType?.includes('json')) {
      // LEGACY FLOW: The request is unencrypted. The system must provision keys for the new employee.
      // We use the employee's URN as the identifier for the new key set.
      const provisionedKeys = await this.kmsService.provisionKeys(employeeUrnForKeys);
      signerJwk = provisionedKeys.keys.find(k => k.kty === 'AKP') as PublicJwk;
      encrypterJwk = provisionedKeys.keys.find(k => k.kty === 'OKP') as PublicJwk;

      if (!signerJwk || !encrypterJwk) {
        throw new ManagerError('Failed to provision keys for new employee in legacy flow.', IssueType.Exception);
      }
    } else {
      // SECURE FLOW: The request is encrypted.
      // If the client provides embedded JWKs, use them; otherwise provision keys server-side.
      signerJwk = jobMeta?.jws?.protected?.jwk as PublicJwk;
      encrypterJwk = jobMeta?.jwe?.header?.jwk as PublicJwk;

      if (!signerJwk || !encrypterJwk) {
        const provisionedKeys = await this.kmsService.provisionKeys(employeeUrnForKeys);
        signerJwk = provisionedKeys.keys.find(k => k.kty === 'AKP') as PublicJwk;
        encrypterJwk = provisionedKeys.keys.find(k => k.kty === 'OKP') as PublicJwk;
      }
    }

    // Additional validation to ensure the keys have kids
    if (!signerJwk.kid || !encrypterJwk.kid) {
      throw new ManagerError('Embedded JWKs must have a "kid" property.', IssueType.Required);
    }

    // Construct the hierarchical URN using the parent tenant's URN.
    const employeeUrn = employeeUrnForKeys;

    // Create verification methods from the provided JWKs
    const verificationMethods: VerificationMethod[] = [
      {
        id: `${employeeUrn}#${signerJwk.kid}`,
        type: 'JsonWebKey',
        controller: employeeUrn,
        publicKeyJwk: signerJwk as PublicJwk,
      },
      {
        id: `${employeeUrn}#${encrypterJwk.kid}`,
        type: 'JsonWebKey',
        controller: employeeUrn,
        publicKeyJwk: encrypterJwk as PublicJwk,
      },
    ];

    const employeeDidDocument: DidDocument = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: employeeUrn,
      verificationMethod: verificationMethods,
      authentication: [verificationMethods[0].id],
      keyAgreement: [verificationMethods[1].id],
      service: [],
    };
    
    // Also add these keys to the parent tenant's DID Document for resolution.
    // This allows others to find the employee's keys by querying the tenant's DID.
    this.tenantsCacheManager.addVerificationMethodToTenant(vaultId, verificationMethods[0]);
    this.tenantsCacheManager.addVerificationMethodToTenant(vaultId, verificationMethods[1]);

    const employeeConfig: EntityConfig = {
      id: employeeId,
      type: EntityType.Person,
      status: EntityLifecycleStatus.Active,
      claims,
      didDocument: employeeDidDocument,
      didConfig: { // didConfig property is required by EntityConfig
        service: []
      },
      meta: {
        lastUpdated: new Date().toISOString(),
      },
    };

    const tenantClaims = await this.tenantsCacheManager.getEntityClaims(vaultId);
    if (!tenantClaims) {
      throw new ManagerError(`Could not retrieve claims for tenant vault ${vaultId}`, IssueType.NotFound);
    }
    
    // Initialize services using the tenant's service claims and the new employee config.
    employeeConfig.didDocument!.service = initializeEmployeeServices(employeeConfig, tenantClaims);
    
    // Also, update the didConfig with the same services.
    employeeConfig.didConfig!.service = employeeConfig.didDocument!.service;

    const occupationDoc: IncludedResource & { employeeId: string } = {
      id: uuidv4(),
      type: 'Occupation',
      employeeId: employeeId,
      meta: {
        claims: {
          [ClaimsPersonSchemaorg.hasOccupation]: roleCode,
        },
      },
    };

    const attributesToIndex: ParameterData[] = [
      { name: 'email', value: email, unique: true, type: 'string'},
      // The role code is normalized before HMAC to ensure consistent searching.
      { name: 'role', value: normalizeCodeSystemAndValue(roleCode), unique: false, type: 'token'},
      { name: 'kid', value: signerJwk.kid, unique: false, type: 'string'},
      { name: 'kid', value: encrypterJwk.kid, unique: false, type: 'string'},
    ];
    
    const protectedAttributes = await this.kmsService.protectAttributesNameAndValue(attributesToIndex, vaultId);

    const docToProtect: ConfidentialStorageDoc = {
      id: employeeConfig.id,
      status: employeeConfig.status,
      sequence: 0,
      content: employeeConfig,
      indexed: { attributes: protectedAttributes },
    };
    
    // The tenant's vaultId is used for the security context.
    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, vaultId);
    await this.vaultRepository.put(vaultId, [secureDoc, occupationDoc], EMPLOYEE_SECTION);

    return {
      type: entryType,
      resource: {
        id: employeeId,
        type: 'Person',
        meta: { claims: claims },
        contained: [occupationDoc],
      },
      response: { status: '201' },
    };
  }

  /**
   * Finds an existing employee by its functional business identity.
   *
   * In v1, employee onboarding is treated as an idempotent/upsert-like flow keyed by
   * `email + role`. The physical record id can still vary across payloads, but the
   * business identity must not create duplicates for the same role assignment.
   */
  private async findEmployeeByEmailAndRole(
    vaultId: string,
    email: string,
    roleCode: string,
  ): Promise<ConfidentialStorageDoc | undefined> {
    const queryAttributes: ParameterData[] = [
      { name: 'email', value: email, unique: true, type: 'string' },
      { name: 'role', value: normalizeCodeSystemAndValue(roleCode), unique: false, type: 'token' },
    ];

    const protectedAttributes = await this.kmsService.protectAttributesNameAndValue(queryAttributes, vaultId);
    const results = await this.vaultRepository.query(vaultId, {
      sectionId: EMPLOYEE_SECTION,
      where: protectedAttributes.map((attribute) => ({
        name: attribute.name,
        value: attribute.value,
      })),
    });

    return ((results || [])[0] as ConfidentialStorageDoc | undefined) || undefined;
  }

  /**
   * Applies v1 upsert semantics for an existing employee record.
   *
   * - active existing employee: return the current record without consuming another seat
   * - inactive existing employee: reactivate it and update claims/metadata in place
   *
   * This keeps `disable` aligned with suspension semantics rather than duplicate recreation.
   */
  private async upsertExistingEmployee(
    employeeDoc: ConfidentialStorageDoc,
    vaultId: string,
    claims: ClaimsRecord,
    entryType: string,
  ): Promise<BundleEntry> {
    const employee = await this.kmsService.unprotectConfidentialData<EntityConfig>(employeeDoc, vaultId);
    const isActive = employee.status === EntityLifecycleStatus.Active;

    if (!isActive) {
      employee.status = EntityLifecycleStatus.Active;
      employee.claims = claims;
      employee.meta = {
        ...(employee.meta || {}),
        lastUpdated: new Date().toISOString(),
      };

      const docToProtect: ConfidentialStorageDoc = {
        ...employeeDoc,
        status: employee.status,
        sequence: (employeeDoc.sequence || 0) + 1,
        content: employee,
      };
      const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, vaultId);
      await this.vaultRepository.put(vaultId, [secureDoc], EMPLOYEE_SECTION);
    }

    return {
      type: entryType,
      resource: {
        id: employee.id,
        type: 'Person',
        meta: { claims: isActive ? employee.claims : claims },
      },
      response: { status: '200' },
    };
  }

  private async tryConsumeEmployeeSeatOrOffer(params: {
    vaultId: string;
    employeeId: string;
    sector: string;
    jurisdiction: string;
  }): Promise<BundleEntry | undefined> {
    const licenseDocs =
      (await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
        params.vaultId,
        DEVICE_LICENSE_SECTION,
      )) || [];

    const employeeLicenseDocs = licenseDocs.filter((doc) => (doc.content as DeviceLicense | undefined)?.userClass === LICENSE_USER_CLASS_EMPLOYEE);
    if (employeeLicenseDocs.length === 0) {
      // No employee licenses in the vault => licensing not configured; do not gate.
      return undefined;
    }

    const availableDoc = employeeLicenseDocs.find((doc) => (doc.content as DeviceLicense).status === LICENSE_STATUS_AVAILABLE);
    if (!availableDoc) {
      const hostDid = (await this.tenantsCacheManager.getTenantDid('host')) || 'did:web:host';
      const allowedPaymentMethods = (process.env.ALLOWED_PAYMENT_METHODS || 'Stripe').split(',').map(s => s.trim()).filter(Boolean);
      const offerClaims = generateLicenseOffer(
        1,
        hostDid,
        params.jurisdiction,
        params.sector,
        allowedPaymentMethods,
        LICENSE_USER_CLASS_EMPLOYEE,
      );

      return {
        type: 'Employee-license-offer-v1.0',
        meta: { claims: offerClaims },
        response: { status: '200' },
      };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const updatedLicense: DeviceLicense = {
      ...(availableDoc.content as DeviceLicense),
      status: LICENSE_STATUS_ISSUED,
      subjectId: params.employeeId,
      issuedAt: nowSec,
    };
    await this.vaultRepository.put(
      params.vaultId,
      [{ ...availableDoc, content: updatedLicense }],
      DEVICE_LICENSE_SECTION,
    );
    return undefined;
  }

  private async disableEmployee(vaultId: string, employeeId: string, entryType: string): Promise<BundleEntry> {
    const employeeDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(vaultId, employeeId, EMPLOYEE_SECTION);
    if (!employeeDoc) {
      throw new ManagerError(`Employee with ID '${employeeId}' not found.`, IssueType.NotFound);
    }

    const employee = await this.kmsService.unprotectConfidentialData<EntityConfig>(employeeDoc, vaultId);
    employee.status = EntityLifecycleStatus.Inactive;

    const docToProtect: ConfidentialStorageDoc = {
      ...employeeDoc,
      status: employee.status,
      sequence: (employeeDoc.sequence || 0) + 1,
      content: employee,
    };
    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, vaultId);
    await this.vaultRepository.put(vaultId, [secureDoc], EMPLOYEE_SECTION);

    return {
      type: entryType,
      resource: { id: employeeId },
      response: { status: '200' },
    };
  }

  private async purgeEmployee(
    vaultId: string,
    employeeId: string,
    claims: ClaimsRecord,
    entryType: string,
  ): Promise<BundleEntry> {
    const employeeDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(vaultId, employeeId, EMPLOYEE_SECTION);
    if (!employeeDoc) {
      throw new ManagerError(`Employee with ID '${employeeId}' not found.`, IssueType.NotFound);
    }

    const employee = await this.kmsService.unprotectConfidentialData<EntityConfig>(employeeDoc, vaultId);
    if (employee.status !== EntityLifecycleStatus.Inactive) {
      throw new ManagerError('Employee must be disabled before purge.', IssueType.Conflict);
    }

    await this.releaseEmployeeLicenses(vaultId, employeeId, employee, claims);

    employee.meta = {
      ...(employee.meta || {}),
      lastUpdated: new Date().toISOString(),
      licensingPurgedAt: new Date().toISOString(),
    };

    const docToProtect: ConfidentialStorageDoc = {
      ...employeeDoc,
      status: employee.status,
      sequence: (employeeDoc.sequence || 0) + 1,
      content: employee,
    };
    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, vaultId);
    await this.vaultRepository.put(vaultId, [secureDoc], EMPLOYEE_SECTION);

    return {
      type: entryType,
      resource: { id: employeeId },
      response: { status: '200' },
    };
  }

  private async releaseEmployeeLicenses(
    vaultId: string,
    employeeId: string,
    employee: EntityConfig,
    claims: ClaimsRecord,
  ): Promise<void> {
    const email = normalizeIndexedEmail(
      employee.claims?.[ClaimsPersonSchemaorg.email]
      || claims?.[ClaimsPersonSchemaorg.email]
      || '',
    );
    const roleCode = normalizeCodeSystemAndValue(
      getPersonOccupationClaim(employee.claims as ClaimsRecord)
      || getPersonOccupationClaim(claims)
      || '',
    );

    const licenseDocs =
      (await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(vaultId, DEVICE_LICENSE_SECTION)) || [];
    const updatedDocs: ConfidentialStorageDoc[] = [];

    for (const doc of licenseDocs) {
      const license = doc.content as DeviceLicense & Record<string, any>;
      if (!license || license.userClass !== LICENSE_USER_CLASS_EMPLOYEE) {
        continue;
      }

      const matchesSubject = license.subjectId === employeeId;
      const matchesInvite = email
        && normalizeIndexedEmail(String(license.issuedToEmail || '')) === email
        && roleCode
        && normalizeCodeSystemAndValue(String(license.issuedToRole || '')) === roleCode;

      if (!matchesSubject && !matchesInvite) {
        continue;
      }

      const resetLicense: DeviceLicense & Record<string, any> = {
        ...license,
        status: LICENSE_STATUS_AVAILABLE,
      };
      delete resetLicense.subjectId;
      delete resetLicense.activationCode;
      delete resetLicense.issuedAt;
      delete resetLicense.issuedToEmail;
      delete resetLicense.issuedToRole;
      delete resetLicense.activatedAt;
      delete resetLicense.deviceId;
      delete resetLicense.deviceInfo;

      updatedDocs.push({
        ...doc,
        status: LICENSE_STATUS_AVAILABLE,
        sequence: (doc.sequence || 0) + 1,
        content: resetLicense,
      });
    }

    if (updatedDocs.length > 0) {
      await this.vaultRepository.put(vaultId, updatedDocs, DEVICE_LICENSE_SECTION);
    }
  }

  private handleError(error: any, entryType: string = 'unknown', meta?: any): ErrorEntry {
    if (error instanceof ManagerError) {
      return {
        type: entryType,
        meta: meta,
        response: {
          status: error.status,
          outcome: createOperationOutcome(IssueLevel.Error, error.code, error.message),
        },
      };
    } else {
      console.error('Unexpected error during employee processing:', error);
      return {
        type: entryType,
        meta: meta,
        response: {
          status: '500',
          outcome: createOperationOutcome(
            IssueLevel.Error,
            IssueType.Exception,
            'An unexpected internal server error occurred.',
          ),
        },
      };
    }
  }
}
