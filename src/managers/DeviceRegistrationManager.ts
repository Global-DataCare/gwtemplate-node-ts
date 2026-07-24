// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/DeviceRegistrationManager.ts

import { v4 as uuidv4 } from 'uuid';
import { IJobProcessor } from './registry';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { BundleJsonApi, BundleEntry, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { composeHostDidWebId } from '../utils/did-backend';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType, IssueLevel } from 'gdc-common-utils-ts/models/issue';
import { createOperationOutcome } from '../utils/outcome';
import { DcrRegistrationRequest, DcrRegistrationResponse, OpenIdDeviceInfo } from 'gdc-common-utils-ts/models/openid-device';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { getTenantVaultId } from '../utils/tenant';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { DeviceLicense, DeviceInfo } from 'gdc-common-utils-ts/models/device-license';
import { getEnvSectionId } from '../utils/section-env';
import { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { DidDocument, VerificationMethod } from '../gdc-backend-utils-node/models/did';
import { registerSubjectKeysOnLedger, revokeSubjectKeysOnLedger } from '../utils/ledger-device-registration';

/**
 * Manages the business logic for a single device registration (DCR) request,
 * following the OpenID Connect Dynamic Client Registration 1.0 standard.
 */
export class DeviceRegistrationManager implements IJobProcessor {
  private readonly apiBaseUrl: string;
  private readonly vaultRepository: IVaultRepository;
  private readonly kmsService?: IKmsService;

  // In the future, we'll inject dependencies like IVaultRepository and a client registry service.
  constructor(apiBaseUrl: string, vaultRepository: IVaultRepository, kmsService?: IKmsService) {
    this.apiBaseUrl = apiBaseUrl;
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
  }

  /**
   * Processes a single device registration job based on OIDC DCR.
   * @param job The incoming job request containing the DCR payload.
   * @returns A promise resolving to a JARM-compliant response payload.
   */
  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    let responseEntry: BundleEntry | ErrorEntry;
    const entryType = job.content?.type || 'openid-dcr-request';

    try {
      const action = String(job.action || '').trim();
      if (!action) {
        throw new ManagerError('Missing action.', IssueType.Required);
      }
      if (action === '_search') {
        return this.handleSearch(job);
      }

      const code = job.content?.body?.code;
      const registrationRequest = job.content?.body as DcrRegistrationRequest;

      // --- Validation Step ---
      this.validateRequest(code, registrationRequest);

      // (Future) Here you would:
      // - Validate the activation code against a database.
      // - Persist the client registration details (client_id, jwks, device_info)
      //   in a dedicated client registry, associated with the user/profile.
      type ExtendedOpenIdDeviceInfo = OpenIdDeviceInfo & {
        os?: string;
        os_version?: string;
      };
      const deviceInfo = registrationRequest.ext_device_info as ExtendedOpenIdDeviceInfo | undefined;
      if (deviceInfo) {
        console.log(`[DCR] Registering client with custom device info: ${deviceInfo.device_name}`);
      }

      // --- Client Creation Step ---
      const clientId = uuidv4();
      const clientIdIssuedAt = Math.floor(Date.now() / 1000);
      
      const registrationResponse: DcrRegistrationResponse = {
        client_id: clientId,
        client_id_issued_at: clientIdIssuedAt,
        // For this flow, we are not issuing a client_secret as authentication is based on the client's public keys (JWKS).
        client_secret_expires_at: 0, 
        // Example registration URI. This should point to where the client config can be managed.
        registration_client_uri: `${this.apiBaseUrl}/clients/${clientId}`,
      };

      // --- Schema.org alignment ---
      // Keep the DCR protocol response separate (resource fields), but include a schema.org view in meta.claims
      // so clients can store/query the registered application metadata consistently.
      const softwareClaims: Record<string, any> = {
        '@context': 'org.schema',
        '@type': 'SoftwareApplication',
        'org.schema.SoftwareApplication.identifier': clientId,
      };
      if (registrationRequest.client_name) {
        softwareClaims['org.schema.SoftwareApplication.name'] = registrationRequest.client_name;
      }
      if (registrationRequest.client_uri) {
        softwareClaims['org.schema.SoftwareApplication.url'] = registrationRequest.client_uri;
      }
      // `device_name` is device-level info; keep it as a simple additional claim for now.
      if (deviceInfo?.device_name) {
        softwareClaims['org.schema.SoftwareApplication.description'] = `Registered on device: ${deviceInfo.device_name}`;
      }

      // --- Persist device profile + bind license (best-effort) ---
      const tenantId = job.tenantId;
      const sector = job.sector;
      if (!tenantId || !sector) {
        throw new ManagerError('Missing tenantId or sector for device registration.', IssueType.Required);
      }

      const vaultId = getTenantVaultId(sector as any, tenantId);
      const licenseDoc = await this.resolveLicenseByActivationCode(code as string, vaultId);
      const deviceIdentityContext = await this.prepareEmployeeDeviceIdentityContext({
        job,
        vaultId,
        registrationRequest,
        licenseDoc,
        clientId,
      });
      const deviceProfile = {
        type: 'DeviceProfile',
        clientId,
        clientIdIssuedAt,
        registrationClientUri: registrationResponse.registration_client_uri,
        activationCode: code,
        redirect_uris: registrationRequest.redirect_uris,
        token_endpoint_auth_method: registrationRequest.token_endpoint_auth_method,
        jwks_uri: registrationRequest.jwks_uri,
        jwks: registrationRequest.jwks,
        ext_device_info: registrationRequest.ext_device_info,
        softwareClaims,
        subjectId: deviceIdentityContext?.subjectId,
        verificationMethodIds: deviceIdentityContext?.newVerificationMethods.map((method) => method.id),
        createdAt: new Date().toISOString(),
      };

      const deviceProfileDoc: ConfidentialStorageDoc = {
        id: clientId,
        status: 'active',
        sequence: 0,
        content: deviceProfile,
      };

      const protectedDeviceProfile = this.kmsService
        ? await this.kmsService.protectConfidentialData(deviceProfileDoc, vaultId)
        : deviceProfileDoc;

      await this.vaultRepository.put(vaultId, [protectedDeviceProfile], getEnvSectionId('device-profiles'));

      // Bind the activated license seat to this client_id and capture a minimal device fingerprint.
      if (licenseDoc) {
        const license = licenseDoc.content as DeviceLicense & Record<string, any>;
        const fingerprint: DeviceInfo = {
          clientInstanceId: deviceInfo?.device_id || clientId,
          os: deviceInfo?.os,
          osVersion: deviceInfo?.os_version,
          model: deviceInfo?.device_name,
        };

        license.deviceId = clientId;
        license.deviceInfo = fingerprint;
        license.status = 'active';
        license.activatedAt = license.activatedAt || Math.floor(Date.now() / 1000);

        licenseDoc.sequence = (licenseDoc.sequence || 0) + 1;
        await this.vaultRepository.put(vaultId, [licenseDoc], getEnvSectionId('device-licenses'));
      }

      if (deviceIdentityContext) {
        await this.finalizeEmployeeDeviceIdentityContext({
          job,
          vaultId,
          clientId,
          context: deviceIdentityContext,
        });
      }

      // --- Response Formatting Step ---
      responseEntry = {
        type: entryType,
        meta: { claims: softwareClaims },
        response: { status: '201' }, // HTTP 201 Created
        resource: {
          resourceType: 'Device', // DCR result wrapped in a device-like resource
          id: clientId,
          // The standard DCR response is embedded directly here.
          ...registrationResponse
        }
      };

    } catch (error) {
      responseEntry = this.handleError(error, entryType, job.content?.meta);
    }

    const responseBundle: BundleJsonApi = {
      data: [responseEntry],
      resourceType: 'Bundle',
      total: 1,
      type: 'transaction-response',
    };

    const issuerDid = composeHostDidWebId(this.apiBaseUrl);

    return {
      jti: uuidv4(),
      type: 'openid-dcr-response',
      thid: job.content?.thid as string,
      iss: issuerDid,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }

  /**
   * Validates the incoming activation code and DCR request payload.
   * @throws {ManagerError} if any validation fails.
   */
  private validateRequest(code: any, request: DcrRegistrationRequest): void {
    // 1. Validate Activation Code
    if (!code || typeof code !== 'string') {
      throw new ManagerError('Activation code is missing or empty', IssueType.Required);
    }
    // Activation codes are tenant-issued opaque strings (e.g., "lic-..."), not UUIDs.
    // Token/_exchange already validates and consumes the code; DCR only requires it to be present.

    // 2. Validate DCR Payload (as per OIDC DCR spec)
    if (!request) {
      throw new ManagerError('Request body is missing', IssueType.Required);
    }
    if (!request.redirect_uris || !Array.isArray(request.redirect_uris) || request.redirect_uris.length === 0) {
      throw new ManagerError('`redirect_uris` is a required field and must be a non-empty array.', IssueType.Value);
    }
    if ((!request.jwks || !request.jwks.keys || request.jwks.keys.length === 0) && !request.jwks_uri) {
      throw new ManagerError('Either `jwks` or `jwks_uri` is a required field.', IssueType.Value);
    }
    if (request.application_type
      && request.application_type !== 'native'
      && request.application_type !== 'web') {
      throw new ManagerError(
        `Unsupported application_type: '${request.application_type}'. Expected 'native' or 'web'.`,
        IssueType.Value,
      );
    }
  }

  /**
   * Handles errors, converting them into a standard ErrorEntry format.
   */
  private handleError(error: any, entryType: string, meta?: any): ErrorEntry {
    if (error instanceof ManagerError) {
      return {
        type: entryType, meta,
        response: {
          status: error.status,
          outcome: createOperationOutcome(IssueLevel.Error, error.code, error.message),
        },
      };
    }
    console.error('[DeviceRegistrationManager] Unexpected error:', error);
    return {
      type: entryType, meta,
      response: {
        status: '500',
        outcome: createOperationOutcome(IssueLevel.Error, IssueType.Exception, 'An unexpected internal server error occurred.'),
      },
    };
  }

  private async resolveLicenseByActivationCode(
    code: string,
    vaultId: string,
  ): Promise<ConfidentialStorageDoc | undefined> {
    if (!code) return undefined;

    let licenseDocs: ConfidentialStorageDoc[] = [];
    if (this.kmsService?.getHmacBase64Url) {
      const protectedName = await this.kmsService.getHmacBase64Url('activationCode', vaultId);
      const protectedValue = await this.kmsService.getHmacBase64Url(code, vaultId);
      if (protectedName && protectedValue) {
        try {
          licenseDocs = (await this.vaultRepository.query(vaultId, {
            sectionId: getEnvSectionId('device-licenses'),
            where: [{ name: protectedName, value: protectedValue }],
          })) as unknown as ConfidentialStorageDoc[];
        } catch {
          licenseDocs = [];
        }
      }
    }

    if (!licenseDocs || licenseDocs.length === 0) {
      const all = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(vaultId, getEnvSectionId('device-licenses'));
      licenseDocs = all.filter((doc) => (doc.content as any)?.activationCode === code);
    }

    if (!licenseDocs || licenseDocs.length === 0) return undefined;
    if (licenseDocs.length > 1) {
      throw new ManagerError('Multiple licenses found for the same activation code.', IssueType.Exception);
    }
    return licenseDocs[0];
  }

  private async prepareEmployeeDeviceIdentityContext(params: {
    job: JobRequest;
    vaultId: string;
    registrationRequest: DcrRegistrationRequest;
    licenseDoc?: ConfidentialStorageDoc;
    clientId: string;
  }): Promise<{
    subjectId: string;
    employeeDoc: ConfidentialStorageDoc;
    employeeContent: EntityConfig;
    previousDeviceId?: string;
    previousDeviceProfileDoc?: ConfidentialStorageDoc;
    previousVerificationMethods: VerificationMethod[];
    newVerificationMethods: VerificationMethod[];
  } | undefined> {
    const subjectId = String((params.licenseDoc?.content as any)?.subjectId || '').trim();
    if (!subjectId) return undefined;

    const employeeDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(
      params.vaultId,
      subjectId,
      getEnvSectionId('employees'),
    );
    if (!employeeDoc) return undefined;

    const employeeContent = this.kmsService
      ? await this.kmsService.unprotectConfidentialData<EntityConfig>(employeeDoc, params.vaultId)
      : (employeeDoc.content as EntityConfig);
    if (!employeeContent?.didDocument?.id) return undefined;

    const previousDeviceId = String((params.licenseDoc?.content as any)?.deviceId || '').trim() || undefined;
    const previousDeviceProfileDoc = previousDeviceId
      ? await this.vaultRepository.get<ConfidentialStorageDoc>(
        params.vaultId,
        previousDeviceId,
        getEnvSectionId('device-profiles'),
      )
      : undefined;
    const previousDeviceProfileContent = previousDeviceProfileDoc
      ? (this.kmsService
        ? await this.kmsService.unprotectConfidentialData<any>(previousDeviceProfileDoc, params.vaultId)
        : (previousDeviceProfileDoc.content as any))
      : undefined;

    return {
      subjectId,
      employeeDoc,
      employeeContent,
      previousDeviceId,
      previousDeviceProfileDoc,
      previousVerificationMethods: this.extractVerificationMethodsFromProfile(
        employeeContent.didDocument,
        previousDeviceProfileContent,
      ),
      newVerificationMethods: this.buildVerificationMethodsForDid(
        employeeContent.didDocument.id,
        params.registrationRequest.jwks,
      ),
    };
  }

  private async finalizeEmployeeDeviceIdentityContext(params: {
    job: JobRequest;
    vaultId: string;
    clientId: string;
    context: {
      subjectId: string;
      employeeDoc: ConfidentialStorageDoc;
      employeeContent: EntityConfig;
      previousDeviceId?: string;
      previousDeviceProfileDoc?: ConfidentialStorageDoc;
      previousVerificationMethods: VerificationMethod[];
      newVerificationMethods: VerificationMethod[];
    };
  }): Promise<void> {
    const {
      employeeDoc,
      employeeContent,
      previousDeviceId,
      previousDeviceProfileDoc,
      previousVerificationMethods,
      newVerificationMethods,
      subjectId,
    } = params.context;

    const updatedDidDocument = this.mergeDeviceVerificationMethods(
      employeeContent.didDocument as DidDocument,
      previousVerificationMethods.map((method) => method.id),
      newVerificationMethods,
    );

    const updatedEmployeeContent: EntityConfig = {
      ...employeeContent,
      didDocument: updatedDidDocument,
      meta: {
        ...(employeeContent.meta || {}),
        lastUpdated: new Date().toISOString(),
      },
    };

    const updatedEmployeeDoc: ConfidentialStorageDoc = {
      ...employeeDoc,
      status: updatedEmployeeContent.status,
      sequence: (employeeDoc.sequence || 0) + 1,
      content: updatedEmployeeContent,
    };
    const protectedEmployeeDoc = this.kmsService
      ? await this.kmsService.protectConfidentialData(updatedEmployeeDoc, params.vaultId)
      : updatedEmployeeDoc;
    await this.vaultRepository.put(params.vaultId, [protectedEmployeeDoc], getEnvSectionId('employees'));

    const organizationId = String(params.job.tenantId || '').trim() || params.vaultId;
    if (previousVerificationMethods.length > 0) {
      await revokeSubjectKeysOnLedger({
        jurisdiction: params.job.jurisdiction,
        organizationId,
        subjectType: 'employee',
        subjectId: updatedDidDocument.id,
        verificationMethods: previousVerificationMethods,
        deviceId: previousDeviceId,
      });
    }
    if (newVerificationMethods.length > 0) {
      await registerSubjectKeysOnLedger({
        jurisdiction: params.job.jurisdiction,
        organizationId,
        subjectType: 'employee',
        subjectId: updatedDidDocument.id,
        verificationMethods: newVerificationMethods,
        deviceId: params.clientId,
      });
    }

    if (previousDeviceProfileDoc && previousDeviceId && previousDeviceId !== params.clientId) {
      const previousContent = this.kmsService
        ? await this.kmsService.unprotectConfidentialData<any>(previousDeviceProfileDoc, params.vaultId)
        : (previousDeviceProfileDoc.content as any);
      const revokedDeviceProfileDoc: ConfidentialStorageDoc = {
        ...previousDeviceProfileDoc,
        status: 'revoked',
        sequence: (previousDeviceProfileDoc.sequence || 0) + 1,
        content: {
          ...(previousContent || {}),
          status: 'revoked',
          revokedAt: new Date().toISOString(),
          replacedByClientId: params.clientId,
          subjectId,
        },
      };
      const protectedRevokedProfile = this.kmsService
        ? await this.kmsService.protectConfidentialData(revokedDeviceProfileDoc, params.vaultId)
        : revokedDeviceProfileDoc;
      await this.vaultRepository.put(
        params.vaultId,
        [protectedRevokedProfile],
        getEnvSectionId('device-profiles'),
      );
    }
  }

  private buildVerificationMethodsForDid(subjectDid: string, jwks?: any): VerificationMethod[] {
    const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
    const methods: VerificationMethod[] = [];

    keys.forEach((rawKey: PublicJwk, index: number) => {
      const key = rawKey as PublicJwk & { key_ops?: string[]; use?: string; alg?: string; crv?: string };
      const keyIdFragment = String(key.kid || `device-key-${index + 1}`).trim();
      const verificationMethodId = `${subjectDid}#${keyIdFragment}`;
      const method: VerificationMethod = {
        id: verificationMethodId,
        type: 'JsonWebKey2020',
        controller: subjectDid,
        publicKeyJwk: key,
      };

      const isSignatureKey = key.use === 'sig'
        || Boolean(key.key_ops?.includes('sign'))
        || String(key.alg || '').toUpperCase().startsWith('ML-DSA')
        || String(key.alg || '').toUpperCase().startsWith('ES');
      const isEncryptionKey = key.use === 'enc'
        || Boolean(key.key_ops?.includes('encrypt'))
        || String(key.alg || '').toUpperCase().startsWith('ECDH')
        || String(key.crv || '').toUpperCase().startsWith('ML-KEM');

      if (isSignatureKey || isEncryptionKey) {
        methods.push(method);
      }
    });

    return methods;
  }

  private extractVerificationMethodsFromProfile(didDocument: DidDocument, profileContent: any): VerificationMethod[] {
    if (!didDocument?.verificationMethod?.length) return [];

    const profileMethodIds = Array.isArray(profileContent?.verificationMethodIds)
      ? profileContent.verificationMethodIds.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : [];
    if (profileMethodIds.length > 0) {
      const methodIdSet = new Set(profileMethodIds);
      return didDocument.verificationMethod.filter((method) => methodIdSet.has(String(method.id || '').trim()));
    }

    const subjectDid = String(didDocument.id || '').trim();
    const fallbackMethods = this.buildVerificationMethodsForDid(subjectDid, profileContent?.jwks);
    const fallbackIds = new Set(fallbackMethods.map((method) => method.id));
    return didDocument.verificationMethod.filter((method) => fallbackIds.has(String(method.id || '').trim()));
  }

  private mergeDeviceVerificationMethods(
    didDocument: DidDocument,
    previousMethodIds: string[],
    newVerificationMethods: VerificationMethod[],
  ): DidDocument {
    const removalSet = new Set(previousMethodIds.map((id) => String(id || '').trim()).filter(Boolean));
    const verificationMethods = Array.isArray(didDocument.verificationMethod) ? [...didDocument.verificationMethod] : [];
    const authentication = Array.isArray(didDocument.authentication) ? [...didDocument.authentication] : [];
    const assertionMethod = Array.isArray(didDocument.assertionMethod) ? [...didDocument.assertionMethod] : [];
    const keyAgreement = Array.isArray(didDocument.keyAgreement) ? [...didDocument.keyAgreement] : [];

    const nextVerificationMethods = verificationMethods.filter((method) => !removalSet.has(String(method.id || '').trim()));
    const filterReferences = (entries: Array<string | VerificationMethod>) => entries.filter((entry) => {
      const id = typeof entry === 'string' ? entry : String(entry?.id || '').trim();
      return !removalSet.has(id);
    });

    const nextAuthentication = filterReferences(authentication);
    const nextAssertionMethod = filterReferences(assertionMethod);
    const nextKeyAgreement = filterReferences(keyAgreement);
    const existingIds = new Set(nextVerificationMethods.map((method) => String(method.id || '').trim()));

    newVerificationMethods.forEach((method) => {
      const methodId = String(method.id || '').trim();
      if (!methodId || existingIds.has(methodId)) return;

      nextVerificationMethods.push(method);
      existingIds.add(methodId);

      const use = String((method.publicKeyJwk as any)?.use || '').trim().toLowerCase();
      const alg = String((method.publicKeyJwk as any)?.alg || '').trim().toUpperCase();
      const crv = String((method.publicKeyJwk as any)?.crv || '').trim().toUpperCase();
      const isSignatureKey = use === 'sig' || alg.startsWith('ML-DSA') || alg.startsWith('ES');
      const isEncryptionKey = use === 'enc' || alg.startsWith('ECDH') || crv.startsWith('ML-KEM');

      if (isSignatureKey) {
        nextAuthentication.push(methodId);
        nextAssertionMethod.push(methodId);
      }
      if (isEncryptionKey) {
        nextKeyAgreement.push(methodId);
      }
    });

    return {
      ...didDocument,
      verificationMethod: nextVerificationMethods,
      authentication: Array.from(new Set(nextAuthentication.map((entry) => typeof entry === 'string' ? entry : String(entry.id || '').trim()))),
      assertionMethod: Array.from(new Set(nextAssertionMethod.map((entry) => typeof entry === 'string' ? entry : String(entry.id || '').trim()))),
      keyAgreement: Array.from(new Set(nextKeyAgreement.map((entry) => typeof entry === 'string' ? entry : String(entry.id || '').trim()))),
    };
  }

  private async handleSearch(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const entryType = job.content?.type || 'device-search-request';
    const { tenantId, sector } = job;
    if (!tenantId || !sector) {
      throw new ManagerError('Missing tenantId or sector.', IssueType.Required);
    }
    const vaultId = getTenantVaultId(sector as any, tenantId);

    const deviceDocs = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
      vaultId,
      getEnvSectionId('device-profiles')
    );

    const entries: BundleEntry[] = [];
    for (const doc of deviceDocs) {
      const content = this.kmsService
        ? await this.kmsService.unprotectConfidentialData<any>(doc, vaultId)
        : (doc as any).content;
      if (!content) continue;

      const clientId = content.clientId || doc.id;
      entries.push({
        type: 'Device:Registered',
        meta: { claims: content.softwareClaims || undefined },
        response: { status: '200' },
        resource: {
          resourceType: 'Device',
          id: clientId,
          client_id: clientId,
          client_id_issued_at: content.clientIdIssuedAt,
          registration_client_uri: content.registrationClientUri,
          ext_device_info: content.ext_device_info,
        },
      });
    }

    const responseBundle: BundleJsonApi = {
      resourceType: 'Bundle',
      type: 'batch-response',
      data: entries,
    };

    return {
      jti: job.content?.jti || 'device-search-response',
      thid: job.content?.thid as string,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      type: 'transaction-response',
      body: responseBundle,
    };
  }
}
