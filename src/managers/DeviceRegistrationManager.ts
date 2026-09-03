// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/DeviceRegistrationManager.ts
import { GatewayResponseEntryTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';

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
import { DeviceBindingStatuses } from 'gdc-common-utils-ts/constants/device';
import {
  IdentityAuthActions,
  IdentityAuthRequestFields,
  IdentityAuthResponseEntryTypes,
  IdentityAuthResponseTypes,
  IdentityDcrMetadataFields,
} from 'gdc-common-utils-ts/constants/identity-auth';
import {
  DCR_REGISTER_SCOPE,
  DEFAULT_LICENSE_DEVICE_ALLOWANCE,
  LICENSE_USER_CLASS_EMPLOYEE,
  LICENSE_USER_CLASS_INDIVIDUAL,
} from '../constants/domain';
import {
  findDeviceLicensesByActivationCode,
  openDeviceLicenseDocument,
  prepareDeviceLicenseDocumentForWrite,
  type OpenedDeviceLicenseDocument,
} from '../utils/device-license-storage';
import type { ITenantsManager } from './ITenantsManager';
import {
  getEmployeeRoleFromUrn,
  getTenantIdentifierUrnPrefix,
  normalizeEmployeeRole,
  parseTenantUrn,
  resolveRoleBearingEmployeeUrn,
} from '../utils/urn';
import { buildOrganizationRoleLicenseId } from 'gdc-common-utils-ts/utils/organization-role-license';
import { hasRoleCode } from 'gdc-common-utils-ts/utils/activation-policy';
import type { ClinicalCreatorBinding } from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import { getClinicalCreatorBindingsSectionId } from '../utils/clinical-creator-binding';
import { resolveRoleLicenseOrganizationOfficialId } from '../utils/ledger-organization-registration-helpers';

/**
 * Manages the business logic for a single device registration (DCR) request,
 * following the OpenID Connect Dynamic Client Registration 1.0 standard.
 */
export class DeviceRegistrationManager implements IJobProcessor {
  private readonly apiBaseUrl: string;
  private readonly vaultRepository: IVaultRepository;
  private readonly kmsService?: IKmsService;
  private readonly tenantsManager?: Pick<ITenantsManager, 'getCollectionName'>;

  // In the future, we'll inject dependencies like IVaultRepository and a client registry service.
  constructor(
    apiBaseUrl: string,
    vaultRepository: IVaultRepository,
    kmsService?: IKmsService,
    tenantsManager?: Pick<ITenantsManager, 'getCollectionName'>,
  ) {
    this.apiBaseUrl = apiBaseUrl;
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsManager = tenantsManager;
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
      if (action === IdentityAuthActions.Search) {
        return this.handleSearch(job);
      }
      if (action === IdentityAuthActions.Revoke) {
        return this.handleRevoke(job);
      }

      const code = job.content?.body?.code;
      const registrationRequest = job.content?.body as DcrRegistrationRequest & {
        software_id?: string;
        software_version?: string;
      };

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
      if (registrationRequest.software_id) softwareClaims['org.schema.SoftwareApplication.applicationCategory'] = registrationRequest.software_id;
      if (registrationRequest.software_version) softwareClaims['org.schema.SoftwareApplication.softwareVersion'] = registrationRequest.software_version;
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
      const openedLicense = await this.resolveLicenseByActivationCode(code as string, vaultId);
      const licenseDoc = openedLicense?.document;
      const license = openedLicense?.license;
      const individualAuthorization = license?.userClass === LICENSE_USER_CLASS_INDIVIDUAL
        ? this.validateIndividualControllerRegistration({
          job,
          registrationRequest: registrationRequest as DcrRegistrationRequest & Record<string, any>,
          license,
          licenseDocId: licenseDoc!.id,
          code: String(code),
        })
        : undefined;
      const fingerprint: DeviceInfo = {
        clientInstanceId: deviceInfo?.device_id || clientId,
        os: deviceInfo?.os,
        osVersion: deviceInfo?.os_version,
        model: deviceInfo?.device_name,
      };
      if (license) this.assertDeviceCapacity(license, fingerprint.clientInstanceId);
      const deviceIdentityContext = await this.prepareEmployeeDeviceIdentityContext({
        job,
        vaultId,
        registrationRequest,
        licenseDoc: licenseDoc && license ? { ...licenseDoc, content: license } : undefined,
        clientId,
      });
      if (license?.userClass === LICENSE_USER_CLASS_EMPLOYEE && license.subjectId && !deviceIdentityContext) {
        throw new ManagerError(
          'DCR could not bind the device keys to the licensed controller identity.',
          IssueType.Conflict,
        );
      }
      const clinicalCreatorBinding = await this.prepareClinicalCreatorBinding({
        vaultId,
        registrationRequest: registrationRequest as DcrRegistrationRequest & Record<string, any>,
        clientId,
        clientInstanceId: fingerprint.clientInstanceId,
      });
      const deviceProfile = {
        type: 'DeviceProfile',
        clientId,
        clientIdIssuedAt,
        registrationClientUri: registrationResponse.registration_client_uri,
        activationCode: code,
        redirect_uris: registrationRequest.redirect_uris,
        token_endpoint_auth_method: registrationRequest.token_endpoint_auth_method,
        application_type: registrationRequest.application_type,
        software_id: registrationRequest.software_id,
        software_version: registrationRequest.software_version,
        jwks_uri: registrationRequest.jwks_uri,
        jwks: registrationRequest.jwks,
        ext_device_info: registrationRequest.ext_device_info,
        softwareClaims,
        subjectId: deviceIdentityContext?.subjectId,
        stableActorIdentifier: deviceIdentityContext?.actorIdentifier,
        verificationMethodIds: deviceIdentityContext?.newVerificationMethods.map((method) => method.id),
        ...(individualAuthorization || {}),
        createdAt: new Date().toISOString(),
      };

      const deviceProfileDoc: ConfidentialStorageDoc = {
        id: clientId,
        status: DeviceBindingStatuses.Active,
        sequence: 0,
        content: deviceProfile,
      };

      const protectedDeviceProfile = this.kmsService
        ? await this.kmsService.protectConfidentialData(deviceProfileDoc, vaultId)
        : deviceProfileDoc;

      await this.vaultRepository.put(vaultId, [protectedDeviceProfile], getEnvSectionId('device-profiles'));
      if (clinicalCreatorBinding) {
        await this.vaultRepository.put(
          vaultId,
          [clinicalCreatorBinding as any],
          getClinicalCreatorBindingsSectionId(),
        );
      }

      // Bind the activated license seat to this client_id and capture a minimal device fingerprint.
      if (licenseDoc && license) {
        const now = Math.floor(Date.now() / 1000);
        const existingBindings = this.getDeviceBindings(license);
        const replacedBinding = existingBindings.find((binding) =>
          binding.status === DeviceBindingStatuses.Active
          && binding.clientInstanceId === fingerprint.clientInstanceId);
        license.maxDevices = this.getDeviceAllowance(license);
        license.deviceBindings = [
          ...existingBindings.map((binding) => binding.clientInstanceId === fingerprint.clientInstanceId
            ? { ...binding, status: DeviceBindingStatuses.Revoked, revokedAt: now }
            : binding),
          { clientId, clientInstanceId: fingerprint.clientInstanceId, status: DeviceBindingStatuses.Active, deviceInfo: fingerprint, activatedAt: now },
        ];
        const replacesLegacyPrimary = replacedBinding && license.deviceId === replacedBinding.clientId;
        license.deviceId = replacesLegacyPrimary ? clientId : (license.deviceId || clientId);
        license.deviceInfo = replacesLegacyPrimary ? fingerprint : (license.deviceInfo || fingerprint);
        license.status = 'active';
        license.activatedAt = license.activatedAt || now;

        licenseDoc.status = 'active';
        licenseDoc.sequence = (licenseDoc.sequence || 0) + 1;
        const updatedDocument = await prepareDeviceLicenseDocumentForWrite({
          document: licenseDoc,
          license,
          vaultId,
          kmsService: this.kmsService,
        });
        await this.vaultRepository.put(vaultId, [updatedDocument], getEnvSectionId('device-licenses'));
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
        response: { status: String(HttpStatusCodes.Created) }, // HTTP 201 Created
        resource: {
          resourceType: ResourceTypesFhirR4.Device, // DCR result wrapped in a device-like resource
          id: clientId,
          meta: { claims: softwareClaims },
          // The standard DCR response is embedded directly here.
          ...registrationResponse
        }
      };

    } catch (error) {
      responseEntry = this.handleError(error, entryType, job.content?.meta);
    }

    const responseBundle: BundleJsonApi = {
      data: [responseEntry],
      resourceType: ResourceTypesFhirR4.Bundle,
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
        status: String(HttpStatusCodes.InternalServerError),
        outcome: createOperationOutcome(IssueLevel.Error, IssueType.Exception, 'An unexpected internal server error occurred.'),
      },
    };
  }

  private async resolveLicenseByActivationCode(
    code: string,
    vaultId: string,
  ): Promise<OpenedDeviceLicenseDocument | undefined> {
    if (!code) return undefined;
    const openedLicenses = await findDeviceLicensesByActivationCode({
      activationCode: code,
      vaultId,
      sectionId: getEnvSectionId('device-licenses'),
      vaultRepository: this.vaultRepository,
      kmsService: this.kmsService,
    });
    if (openedLicenses.length === 0) return undefined;
    if (openedLicenses.length > 1) {
      throw new ManagerError('Multiple licenses found for the same activation code.', IssueType.Exception);
    }
    return openedLicenses[0];
  }

  private getDeviceAllowance(license: DeviceLicense & Record<string, any>): number {
    const value = Number(license.maxDevices);
    return Number.isInteger(value) && value > 0 ? value : DEFAULT_LICENSE_DEVICE_ALLOWANCE;
  }

  /** Links one registered device only to an exact pre-authorized creator assignment. */
  private async prepareClinicalCreatorBinding(params: {
    vaultId: string;
    registrationRequest: DcrRegistrationRequest & Record<string, any>;
    clientId: string;
    clientInstanceId: string;
  }): Promise<(ClinicalCreatorBinding & { id: string }) | undefined> {
    const requested = params.registrationRequest[IdentityDcrMetadataFields.ClinicalCreatorBinding];
    if (requested === undefined) return undefined;
    if (!isClinicalCreatorBinding(requested)) {
      throw new ManagerError('DCR clinical creator binding is malformed.', IssueType.Value);
    }
    const existing = await this.vaultRepository.get<any>(
      params.vaultId,
      requested.authorIdentifier,
      getClinicalCreatorBindingsSectionId(),
    );
    if (!isClinicalCreatorBinding(existing)
      || !sameStableClinicalCreatorBinding(existing, requested)) {
      throw new ManagerError(
        'DCR clinical creator binding was not pre-authorized for this tenant.',
        IssueType.Forbidden,
      );
    }
    const actorDid = String(params.registrationRequest[IdentityDcrMetadataFields.ActorDid] || '').trim();
    if (!actorDid) {
      throw new ManagerError('DCR clinical creator binding requires actor_did.', IssueType.Required);
    }
    const keyIds = Array.isArray(params.registrationRequest.jwks?.keys)
      ? params.registrationRequest.jwks.keys
        .map((key: any) => String(key?.kid || '').trim())
        .filter(Boolean)
      : [];
    return {
      ...existing,
      id: existing.authorIdentifier,
      actorDids: uniqueText([...(existing.actorDids || []), actorDid]),
      dcrClientIds: uniqueText([
        ...(existing.dcrClientIds || []),
        params.clientId,
        params.clientInstanceId,
      ]),
      keyIds: uniqueText([...(existing.keyIds || []), ...keyIds]),
    };
  }

  /** Converts a verified individual activation into one exact DCR authorization tuple. */
  private validateIndividualControllerRegistration(params: {
    job: JobRequest;
    registrationRequest: DcrRegistrationRequest & Record<string, any>;
    license: DeviceLicense & Record<string, any>;
    licenseDocId: string;
    code: string;
  }): {
    actorDid: string;
    profileDid: string;
    authorizedSubjectDid: string;
    authenticatedSubject: string;
    licenseId: string;
  } {
    const bearer = (params.job.content as any)?.meta?.bearer?.jwt?.payload || {};
    const authenticatedSubject = String(bearer.sub || '').trim();
    if (!authenticatedSubject || String(bearer.scope || '').trim() !== DCR_REGISTER_SCOPE) {
      throw new ManagerError('Individual-controller DCR requires a verified initial access token.', IssueType.Security);
    }
    if (String(bearer.act_code || '').trim() !== params.code) {
      throw new ManagerError('DCR activation code does not match the verified initial access token.', IssueType.Forbidden);
    }
    const actorDid = String(params.registrationRequest[IdentityDcrMetadataFields.ActorDid] || '').trim();
    const profileDid = String(params.registrationRequest[IdentityDcrMetadataFields.ProfileDid] || '').trim();
    const authorizedSubjectDid = String(params.license.authorizedSubjectDid || '').trim();
    if (!actorDid || profileDid !== actorDid || !authorizedSubjectDid) {
      throw new ManagerError(
        'Individual-controller DCR is missing its exact actor, profile or authorized subject binding.',
        IssueType.Forbidden,
      );
    }
    const familyPrefix = `${authorizedSubjectDid}:family:`;
    if (!actorDid.startsWith(familyPrefix)) {
      throw new ManagerError('Individual-controller actor does not belong to the licensed subject.', IssueType.Forbidden);
    }
    const encodedRemainder = actorDid.slice(familyPrefix.length);
    const separator = encodedRemainder.indexOf(':');
    const actorIdentifier = decodeURIComponent(separator >= 0 ? encodedRemainder.slice(0, separator) : encodedRemainder);
    const actorRole = decodeURIComponent(separator >= 0 ? encodedRemainder.slice(separator + 1) : '');
    const issuedRoleCode = String(params.license.issuedToRole || '').split(/[|:]/).pop()?.toLowerCase();
    const actorRoleCode = actorRole.split(/[|:]/).pop()?.toLowerCase();
    if (actorIdentifier !== authenticatedSubject
      || !issuedRoleCode
      || issuedRoleCode !== actorRoleCode
      || !hasRoleCode(actorRole)
      || !hasRoleCode(params.license.issuedToRole)) {
      if (!hasRoleCode(actorRole) || !hasRoleCode(params.license.issuedToRole)) {
        throw new ManagerError(
          'Individual-controller DCR requires the licensed controller role RESPRSN.',
          IssueType.Forbidden,
        );
      }
      throw new ManagerError(
        'Individual-controller actor does not match the activated account or licensed role.',
        IssueType.Forbidden,
      );
    }
    return {
      actorDid,
      profileDid,
      authorizedSubjectDid,
      authenticatedSubject,
      licenseId: params.licenseDocId,
    };
  }

  private getDeviceBindings(license: DeviceLicense & Record<string, any>): any[] {
    if (Array.isArray(license.deviceBindings)) return license.deviceBindings;
    const clientId = String(license.deviceId || '').trim();
    if (!clientId) return [];
    const deviceInfo = license.deviceInfo || { clientInstanceId: clientId };
    return [{
      clientId,
      clientInstanceId: String(deviceInfo.clientInstanceId || clientId),
      status: DeviceBindingStatuses.Active,
      deviceInfo,
      activatedAt: Number(license.activatedAt || 0),
    }];
  }

  private assertDeviceCapacity(license: DeviceLicense & Record<string, any>, clientInstanceId: string): void {
    const active = this.getDeviceBindings(license).filter((binding) => binding.status === DeviceBindingStatuses.Active);
    if (active.some((binding) => binding.clientInstanceId === clientInstanceId)) return;
    if (active.length >= this.getDeviceAllowance(license)) {
      throw new ManagerError(
        `Device allowance exhausted for this license (${active.length}/${this.getDeviceAllowance(license)}).`,
        IssueType.Conflict,
      );
    }
  }

  private async prepareEmployeeDeviceIdentityContext(params: {
    job: JobRequest;
    vaultId: string;
    registrationRequest: DcrRegistrationRequest;
    licenseDoc?: ConfidentialStorageDoc;
    clientId: string;
  }): Promise<{
    subjectId: string;
    actorIdentifier: string;
    employeeUrn: string;
    licensedRole: string;
    roleLicenseId: string;
    organizationId: string;
    jurisdiction: string;
    employeeDoc: ConfidentialStorageDoc;
    employeeContent: EntityConfig;
    previousDeviceId?: string;
    previousDeviceProfileDoc?: ConfidentialStorageDoc;
    previousVerificationMethods: VerificationMethod[];
    newVerificationMethods: VerificationMethod[];
  } | undefined> {
    const subjectId = String((params.licenseDoc?.content as any)?.subjectId || '').trim();
    if (!subjectId) return undefined;

    const employeeCollectionName = await this.resolveEmployeeCollectionName(params.vaultId);
    const employeeDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(
      employeeCollectionName,
      subjectId,
      getEnvSectionId('employees'),
    );
    if (!employeeDoc) return undefined;

    const employeeContent = this.kmsService
      ? await this.kmsService.unprotectConfidentialData<EntityConfig>(employeeDoc, params.vaultId)
      : (employeeDoc.content as EntityConfig);
    if (!employeeContent?.didDocument?.id) return undefined;

    const license = (params.licenseDoc?.content || {}) as DeviceLicense & Record<string, any>;
    const actorIdentifier = String(license.activatedBy || '').trim();
    if (!/^urn:multibase:z[^:]+$/.test(actorIdentifier)) {
      throw new ManagerError('DCR license is missing its stable actor identifier.', IssueType.BusinessRule);
    }
    const employeeUrn = resolveRoleBearingEmployeeUrn(employeeContent.didDocument);
    if (!employeeUrn) {
      throw new ManagerError('DCR employee identity is missing its role-bearing employee URN.', IssueType.BusinessRule);
    }
    const licensedRole = String(license.issuedToRole || '').trim();
    if (getEmployeeRoleFromUrn(employeeUrn) !== normalizeEmployeeRole(licensedRole)) {
      throw new ManagerError('DCR licence role does not match the role-bearing employee identity.', IssueType.Conflict);
    }
    const employeeTenantUrn = parseTenantUrn(getTenantIdentifierUrnPrefix(employeeUrn));
    const jurisdiction = String(params.job.jurisdiction || employeeTenantUrn?.jurisdiction || '').trim();
    const organizationId = String(employeeTenantUrn?.idValue || params.job.tenantId || params.vaultId).trim();
    const roleLicenseId = buildOrganizationRoleLicenseId({
      organizationOfficialId: resolveRoleLicenseOrganizationOfficialId(
        String(license.ownerOrganizationId || organizationId),
      ),
      jurisdiction: jurisdiction.toLowerCase(),
      stableContactIdentifier: actorIdentifier,
      licensedRole,
    });
    const clientInstanceId = String((params.registrationRequest.ext_device_info as any)?.device_id || params.clientId).trim();
    const replacedBinding = this.getDeviceBindings(license).find((binding) =>
      binding.status === DeviceBindingStatuses.Active && binding.clientInstanceId === clientInstanceId);
    const previousDeviceId = String(replacedBinding?.clientId || '').trim() || undefined;
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
      actorIdentifier,
      employeeUrn,
      licensedRole,
      roleLicenseId,
      organizationId,
      jurisdiction,
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

  /** Employee identities may live in the tenant's physical collection. */
  private async resolveEmployeeCollectionName(vaultId: string): Promise<string> {
    return await this.tenantsManager?.getCollectionName(vaultId) || vaultId;
  }

  private async finalizeEmployeeDeviceIdentityContext(params: {
    job: JobRequest;
    vaultId: string;
    clientId: string;
    context: {
      subjectId: string;
      actorIdentifier: string;
      employeeUrn: string;
      licensedRole: string;
      roleLicenseId: string;
      organizationId: string;
      jurisdiction: string;
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
      employeeUrn,
      licensedRole,
      roleLicenseId,
      organizationId,
      jurisdiction,
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

    const currentKids = Array.from(new Set((updatedDidDocument.verificationMethod || [])
      .map((method) => String(method.publicKeyJwk?.kid || method.id?.split('#').at(-1) || '').trim())
      .filter(Boolean)));
    const protectedKidAttributes = this.kmsService
      ? await this.kmsService.protectAttributesNameAndValue(currentKids.map((kid) => ({
        name: 'kid',
        value: kid,
        unique: false,
        type: 'string',
      })), params.vaultId)
      : currentKids.map((kid) => ({ name: 'kid', value: kid, unique: false, type: 'string' }));
    const protectedKidName = protectedKidAttributes[0]?.name;
    const retainedAttributes = (employeeDoc.indexed?.attributes || [])
      .filter((attribute) => !protectedKidName || attribute.name !== protectedKidName);

    const updatedEmployeeDoc: ConfidentialStorageDoc = {
      ...employeeDoc,
      status: updatedEmployeeContent.status,
      sequence: (employeeDoc.sequence || 0) + 1,
      content: updatedEmployeeContent,
      indexed: {
        ...(employeeDoc.indexed || {}),
        attributes: [...retainedAttributes, ...protectedKidAttributes],
      },
    };
    const protectedEmployeeDoc = this.kmsService
      ? await this.kmsService.protectConfidentialData(updatedEmployeeDoc, params.vaultId)
      : updatedEmployeeDoc;
    const employeeCollectionName = await this.resolveEmployeeCollectionName(params.vaultId);
    await this.vaultRepository.put(employeeCollectionName, [protectedEmployeeDoc], getEnvSectionId('employees'));

    if (previousVerificationMethods.length > 0) {
      await revokeSubjectKeysOnLedger({
        jurisdiction,
        organizationId,
        subjectType: 'employee',
        subjectId: employeeUrn,
        subjectDid: updatedDidDocument.id,
        licensedRole,
        roleLicenseId,
        verificationMethods: previousVerificationMethods,
        deviceId: previousDeviceId,
      });
    }
    if (newVerificationMethods.length > 0) {
      await registerSubjectKeysOnLedger({
        jurisdiction,
        organizationId,
        subjectType: 'employee',
        subjectId: employeeUrn,
        subjectDid: updatedDidDocument.id,
        licensedRole,
        roleLicenseId,
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
        status: DeviceBindingStatuses.Revoked,
        sequence: (previousDeviceProfileDoc.sequence || 0) + 1,
        content: {
          ...(previousContent || {}),
          status: DeviceBindingStatuses.Revoked,
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
        type: GatewayResponseEntryTypes.DeviceRegistered,
        response: { status: String(HttpStatusCodes.Ok) },
        resource: {
          resourceType: ResourceTypesFhirR4.Device,
          id: clientId,
          meta: { claims: content.softwareClaims || undefined },
          client_id: clientId,
          client_id_issued_at: content.clientIdIssuedAt,
          registration_client_uri: content.registrationClientUri,
          ext_device_info: content.ext_device_info,
        },
      });
    }

    const responseBundle: BundleJsonApi = {
      resourceType: ResourceTypesFhirR4.Bundle,
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

  /** Revokes one installation while preserving the employee seat and its other active devices. */
  private async handleRevoke(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const tenantId = String(job.tenantId || '').trim();
    const sector = String(job.sector || '').trim();
    const requestBody = job.content?.body as Record<string, unknown> | undefined;
    const licenseId = String(requestBody?.[IdentityAuthRequestFields.LicenseId] || '').trim();
    const clientId = String(requestBody?.[IdentityAuthRequestFields.ClientId] || '').trim();
    if (!tenantId || !sector) throw new ManagerError('Missing tenantId or sector.', IssueType.Required);
    if (!licenseId || !clientId) throw new ManagerError('license_id and client_id are required.', IssueType.Required);

    const vaultId = getTenantVaultId(sector as any, tenantId);
    const licenseDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(
      vaultId, licenseId, getEnvSectionId('device-licenses'),
    );
    if (!licenseDoc) throw new ManagerError('License not found.', IssueType.NotFound);
    const { license } = await openDeviceLicenseDocument(licenseDoc, vaultId, this.kmsService);
    const bindings = this.getDeviceBindings(license);
    const target = bindings.find((binding) => binding.status === DeviceBindingStatuses.Active && binding.clientId === clientId);
    if (!target) throw new ManagerError('Active device binding not found for this license.', IssueType.NotFound);

    const now = Math.floor(Date.now() / 1000);
    license.deviceBindings = bindings.map((binding) => binding.clientId === clientId
      ? { ...binding, status: DeviceBindingStatuses.Revoked, revokedAt: now }
      : binding);
    licenseDoc.sequence = (licenseDoc.sequence || 0) + 1;
    const updatedLicenseDocument = await prepareDeviceLicenseDocumentForWrite({
      document: licenseDoc,
      license,
      vaultId,
      kmsService: this.kmsService,
    });
    await this.vaultRepository.put(vaultId, [updatedLicenseDocument], getEnvSectionId('device-licenses'));

    const profileDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(
      vaultId, clientId, getEnvSectionId('device-profiles'),
    );
    const profile = profileDoc
      ? (this.kmsService ? await this.kmsService.unprotectConfidentialData<any>(profileDoc, vaultId) : profileDoc.content as any)
      : undefined;
    if (profileDoc) {
      const revokedProfile: ConfidentialStorageDoc = {
        ...profileDoc,
        status: DeviceBindingStatuses.Revoked,
        sequence: (profileDoc.sequence || 0) + 1,
        content: { ...(profile || {}), status: DeviceBindingStatuses.Revoked, revokedAt: new Date().toISOString() },
      };
      await this.vaultRepository.put(vaultId, [this.kmsService
        ? await this.kmsService.protectConfidentialData(revokedProfile, vaultId)
        : revokedProfile], getEnvSectionId('device-profiles'));
    }

    const subjectId = String(license.subjectId || '').trim();
    if (subjectId && profile) {
      const employeeCollectionName = await this.resolveEmployeeCollectionName(vaultId);
      const employeeDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(
        employeeCollectionName, subjectId, getEnvSectionId('employees'),
      );
      if (employeeDoc) {
        const employee = this.kmsService
          ? await this.kmsService.unprotectConfidentialData<EntityConfig>(employeeDoc, vaultId)
          : employeeDoc.content as EntityConfig;
        if (employee.didDocument) {
          const employeeUrn = resolveRoleBearingEmployeeUrn(employee.didDocument);
          if (!employeeUrn) {
            throw new ManagerError('DCR employee identity is missing its role-bearing employee URN.', IssueType.BusinessRule);
          }
          const licensedRole = String(license.issuedToRole || '').trim();
          if (getEmployeeRoleFromUrn(employeeUrn) !== normalizeEmployeeRole(licensedRole)) {
            throw new ManagerError('DCR licence role does not match the role-bearing employee identity.', IssueType.Conflict);
          }
          const employeeTenantUrn = parseTenantUrn(getTenantIdentifierUrnPrefix(employeeUrn));
          const jurisdiction = String(job.jurisdiction || employeeTenantUrn?.jurisdiction || '').trim();
          const organizationId = String(employeeTenantUrn?.idValue || tenantId).trim();
          const roleLicenseId = buildOrganizationRoleLicenseId({
            organizationOfficialId: resolveRoleLicenseOrganizationOfficialId(
              String(license.ownerOrganizationId || organizationId),
            ),
            jurisdiction: jurisdiction.toLowerCase(),
            stableContactIdentifier: String(license.activatedBy || '').trim(),
            licensedRole,
          });
          const methods = this.extractVerificationMethodsFromProfile(employee.didDocument, profile);
          employee.didDocument = this.mergeDeviceVerificationMethods(
            employee.didDocument, methods.map((method) => method.id), [],
          );
          const updatedEmployeeDoc: ConfidentialStorageDoc = {
            ...employeeDoc,
            sequence: (employeeDoc.sequence || 0) + 1,
            content: employee,
          };
          await this.vaultRepository.put(employeeCollectionName, [this.kmsService
            ? await this.kmsService.protectConfidentialData(updatedEmployeeDoc, vaultId)
            : updatedEmployeeDoc], getEnvSectionId('employees'));
          if (methods.length) await revokeSubjectKeysOnLedger({
            jurisdiction,
            organizationId,
            subjectType: 'employee',
            subjectId: employeeUrn,
            subjectDid: employee.didDocument.id,
            licensedRole,
            roleLicenseId,
            verificationMethods: methods,
            deviceId: clientId,
          });
        }
      }
    }

    return {
      jti: uuidv4(), thid: job.content?.thid as string, type: IdentityAuthResponseTypes.DeviceRevoke,
      iss: composeHostDidWebId(this.apiBaseUrl), aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: {
        resourceType: ResourceTypesFhirR4.Bundle, type: 'transaction-response', total: 1,
        data: [{ type: IdentityAuthResponseEntryTypes.DeviceRevoked, response: { status: String(HttpStatusCodes.Ok) }, resource: { resourceType: ResourceTypesFhirR4.Device, id: clientId, status: DeviceBindingStatuses.Revoked } }],
      },
    };
  }
}

function isClinicalCreatorBinding(value: unknown): value is ClinicalCreatorBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return typeof binding.kind === 'string'
    && typeof binding.actorIdentifier === 'string'
    && typeof binding.authorIdentifier === 'string'
    && typeof binding.ownerIdentifier === 'string'
    && typeof binding.role === 'string';
}

function sameStableClinicalCreatorBinding(
  left: ClinicalCreatorBinding,
  right: ClinicalCreatorBinding,
): boolean {
  return left.kind === right.kind
    && left.actorIdentifier === right.actorIdentifier
    && left.authorIdentifier === right.authorIdentifier
    && left.ownerIdentifier === right.ownerIdentifier
    && left.role === right.role;
}

function uniqueText(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}
