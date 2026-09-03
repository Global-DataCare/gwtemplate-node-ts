import { GatewayResponseEntryTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import { v4 as uuidv4 } from 'uuid';
import { BundleEntry, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import {
  extractRepresentativeMemberOfLegalIdentifier,
  legalOrganizationIdentifiersMatch,
} from 'gdc-common-utils-ts/utils/activation-policy';
import { OrganizationConfig } from '../../gdc-backend-utils-node/models/entity';
import { EntityLifecycleStatus } from '../../gdc-backend-utils-node/models/enums';
import type { IServerConfig } from '../../config';
import type { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import type { IStorageAdapter } from '../../database/storage/IStorageAdapter';
import { composeHostDidWebId } from '../../utils/did-backend';
import { getBundleResponseTypeForAction } from '../../utils/bundle';
import { normalizeContextualizedClaims } from '../../utils/claims';
import { getEnvSectionId } from '../../utils/section-env';
import type { IHostingTenantRegistry } from '../IHostingTenantRegistry';
import type { IHostRuntime } from '../IHostRuntime';
import {
  applyTenantAuthorizationStatus,
  getTenantAuthorizationStatus,
  TenantAuthorizationLifecycleStatus,
} from '../../utils/tenant-lifecycle';
import {
  ACTION_DISABLE,
  ACTION_DISABLE_DESCENDANTS,
  ACTION_ENABLE,
  ACTION_PURGE,
  ACTION_PURGE_DESCENDANTS,
  ACTION_STATUS,
  SUBJECT_SECTION_INDIVIDUAL,
} from '../../constants/domain';
import { GatewayClaim } from '../../shared/gateway-claim-contract';

type TenantLifecycleAction =
  | typeof ACTION_DISABLE
  | typeof ACTION_ENABLE
  | typeof ACTION_PURGE
  | typeof ACTION_STATUS
  | typeof ACTION_DISABLE_DESCENDANTS
  | typeof ACTION_PURGE_DESCENDANTS;
type TenantDescendantKind = 'individuals';
type TenantDescendantLifecycleSummary = {
  activeEmployees: number;
  activeIndividuals: number;
  unpurgedEmployees: number;
  unpurgedIndividuals: number;
};
type HostedTenantRegistrySummary = {
  registeredHostedTenants: number;
};
type LifecycleAuthorizationContext = {
  actorDid?: string;
  bearerPayload?: Record<string, unknown>;
};

/**
 * Technical marker copied to `ConfidentialStorageDoc.public.role` for the
 * synthetic bootstrap controller employee created during hosted tenant setup.
 *
 * Lifecycle scans intentionally ignore records with this marker so that a
 * bootstrap-only employee does not block host/tenant `disable` or `purge`.
 */
const HOST_BOOTSTRAP_CONTROLLER_LIFECYCLE_ROLE = 'host-bootstrap-controller';
const PURGED_LIFECYCLE_DISPOSITION = 'purged';

export class HostingLifecycleService {
  constructor(
    private readonly vaultRepository: IVaultRepository,
    private readonly kmsService: IKmsService,
    private readonly tenantsCacheManager: IHostingTenantRegistry,
    private readonly config: IServerConfig,
    private readonly hostRuntime: IHostRuntime,
    private readonly storageAdapter: IStorageAdapter,
    private readonly handleError: (error: unknown, type: string, meta?: Record<string, unknown>) => ErrorEntry,
  ) {}

  async processOrganizationLifecycle(job: JobRequest): Promise<any> {
    const jobEntries = job?.content?.body?.data || [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];
    const authorization = this.resolveLifecycleAuthorization(job);

    for (const entry of jobEntries) {
      try {
        const resultEntry = await this.processLifecycleEntry(
          entry,
          job.action as TenantLifecycleAction,
          authorization,
        );
        responseEntries.push(resultEntry);
      } catch (error) {
        responseEntries.push(this.handleError(error, entry?.type || 'Organization', entry?.meta));
      }
    }

    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    return {
      jti: uuidv4(),
      type: 'hosting-response',
      thid: job.content?.thid as string,
      iss: issuerDid,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: {
        data: responseEntries,
        resourceType: ResourceTypesFhirR4.Bundle,
        type: getBundleResponseTypeForAction(job.action),
        total: responseEntries.length,
      },
    };
  }

  private async processLifecycleEntry(
    entry: BundleEntry,
    action: TenantLifecycleAction,
    authorization: LifecycleAuthorizationContext,
  ): Promise<BundleEntry | ErrorEntry> {
    const rawClaims = entry?.resource?.meta?.claims || entry?.meta?.claims;
    const claims = rawClaims ? normalizeContextualizedClaims(rawClaims) : undefined;
    if (!claims) {
      throw new ManagerError('Malformed lifecycle entry: missing meta.claims', IssueType.Required);
    }

    const identifierValue = String(claims[ClaimsOrganizationSchemaorg.identifierValue] || '').trim();
    if (!identifierValue) {
      throw new ManagerError(`Missing required claim: '${ClaimsOrganizationSchemaorg.identifierValue}'`, IssueType.Required);
    }

    /**
     * Host lifecycle entries are addressed by the configured host
     * `identifier.value`, but the host registry record is always stored under
     * the logical vault id `'host'`.
     *
     * Resolving host lifecycle through hosted-tenant reverse lookup is wrong:
     * - host disable/purge would try to find a hosted tenant by the host
     *   identifier value
     * - local/live runs generate a fresh host identifier value per execution
     * - the lifecycle manager must therefore short-circuit directly to the
     *   logical host vault id
     */
    const vaultId = identifierValue === this.config.host.idValue
      ? 'host'
      : await this.tenantsCacheManager.findTenantVaultIdByIdentifierValue(identifierValue);
    if (!vaultId) {
      throw new ManagerError(`Tenant not found for identifier.value '${identifierValue}'`, IssueType.NotFound);
    }

    const hostCollectionName = this.hostRuntime.hostCollectionName;

    const tenantConfig = await this.tenantsCacheManager.getTenant(vaultId) as OrganizationConfig | undefined;
    if (!tenantConfig) {
      throw new ManagerError(`Tenant registration not found for '${vaultId}'`, IssueType.NotFound);
    }
    const currentStatus = getTenantAuthorizationStatus(tenantConfig);
    const isHostLifecycle = vaultId === 'host';
    if (!isHostLifecycle) {
      this.assertControllerProofBearerTenantBinding(
        authorization.bearerPayload,
        tenantConfig,
      );
    }
    const descendants = isHostLifecycle
      ? undefined
      : await this.inspectTenantDescendants(vaultId);
    if (action === ACTION_STATUS) {
      return this.buildLifecycleStatusResponse(entry, tenantConfig, identifierValue, currentStatus, descendants!);
    }
    if (action === ACTION_DISABLE_DESCENDANTS || action === ACTION_PURGE_DESCENDANTS) {
      const descendantKind = this.readDescendantKind(entry);
      await this.changeTenantDescendants(
        vaultId,
        descendantKind,
        action === ACTION_PURGE_DESCENDANTS ? 'purge' : 'disable',
      );
      const updatedSummary = await this.inspectTenantDescendants(vaultId);
      return this.buildLifecycleStatusResponse(entry, tenantConfig, identifierValue, currentStatus, updatedSummary);
    }
    if (action === ACTION_PURGE) {
      if (isHostLifecycle) {
        await this.assertHostLifecycleAllowed(action, hostCollectionName);
        const hostVaultPurged = await this.vaultRepository.purge(hostCollectionName);
        if (!hostVaultPurged) {
          throw new ManagerError("Host data purge failed for 'host'.", IssueType.Exception);
        }
        await this.tenantsCacheManager.refreshTenant('host');

        return {
          type: GatewayResponseEntryTypes.OrganizationPurge,
          resource: {
            resourceType: ResourceTypesFhirR4.Organization,
            id: tenantConfig.id,
            meta: { claims: {
              ...claims,
              [ClaimsOrganizationSchemaorg.identifierValue]: identifierValue,
              [GatewayClaim.TenantAuthorizationStatus]: 'revoked',
              [GatewayClaim.TenantAuthorizationChangedBy]: authorization.actorDid || '',
              [GatewayClaim.TenantAuthorizationLifecycleDisposition]: 'purged',
            } },
          },
          response: { status: String(HttpStatusCodes.Ok) },
        };
      }
      await this.assertTenantPurgeAllowed(currentStatus);
      this.assertNoUnpurgedTenantDescendants(descendants!);
      const tenantRegistryDeleted = await this.vaultRepository.delete(hostCollectionName, vaultId, getEnvSectionId('tenants'));
      if (!tenantRegistryDeleted) {
        throw new ManagerError(`Tenant registry purge failed for '${vaultId}'.`, IssueType.Exception);
      }
      await this.tenantsCacheManager.refreshTenant(vaultId);

      return {
        type: GatewayResponseEntryTypes.OrganizationPurge,
        resource: {
          resourceType: ResourceTypesFhirR4.Organization,
          id: tenantConfig.id,
          meta: { claims: {
            ...claims,
            [ClaimsOrganizationSchemaorg.identifierValue]: identifierValue,
            [GatewayClaim.TenantAuthorizationStatus]: 'revoked',
            [GatewayClaim.TenantAuthorizationChangedBy]: authorization.actorDid || '',
            [GatewayClaim.TenantAuthorizationLifecycleDisposition]: 'purged',
          } },
        },
        response: { status: String(HttpStatusCodes.Ok) },
      };
    }

    const nextStatus = this.getNextTenantLifecycleStatus(action, currentStatus);
    if (isHostLifecycle) {
      await this.assertHostLifecycleAllowed(action, hostCollectionName);
    } else if (action === ACTION_DISABLE) {
      this.assertNoActiveTenantDescendants(descendants!);
    }
    const updatedConfig = applyTenantAuthorizationStatus(tenantConfig, nextStatus, authorization.actorDid);
    const existing = isHostLifecycle
      ? await this.vaultRepository.get<any>(hostCollectionName, 'host', getEnvSectionId('tenants'))
      : (await this.vaultRepository.query(
        hostCollectionName,
        { sectionId: getEnvSectionId('tenants'), where: [{ name: ClaimsOrganizationSchemaorg.identifierValue, value: identifierValue }] },
        { hydrate: false },
      )).find((doc) => String(doc?.id || '').trim() === vaultId);
    if (!existing) {
      throw new ManagerError(`Tenant registry document not found for '${vaultId}'.`, IssueType.NotFound);
    }

    const updatedDoc = {
      ...existing,
      status: updatedConfig.status,
      content: updatedConfig,
    };
    const secureDoc = await this.kmsService.protectConfidentialData(updatedDoc, 'host');
    await this.vaultRepository.put(hostCollectionName, [secureDoc], getEnvSectionId('tenants'));
    await this.tenantsCacheManager.refreshTenant(vaultId);

    return {
      type: action === ACTION_DISABLE ? 'Organization-disable-response-v1.0' : 'Organization-enable-response-v1.0',
      resource: {
        resourceType: ResourceTypesFhirR4.Organization,
        id: tenantConfig.id,
        meta: { claims: {
          ...claims,
          [ClaimsOrganizationSchemaorg.identifierValue]: identifierValue,
          [GatewayClaim.TenantAuthorizationStatus]: nextStatus,
          [GatewayClaim.TenantAuthorizationChangedBy]: authorization.actorDid || '',
        } },
      },
      response: { status: String(HttpStatusCodes.Ok) },
    };
  }

  private resolveLifecycleAuthorization(job: JobRequest): LifecycleAuthorizationContext {
    const bearerPayload = (job?.content as any)?.meta?.bearer?.jwt?.payload;
    const normalizedBearerPayload = bearerPayload && typeof bearerPayload === 'object'
      ? bearerPayload as Record<string, unknown>
      : undefined;
    const proofActorDid = normalizedBearerPayload
      ? String(normalizedBearerPayload.iss || normalizedBearerPayload.sub || '').trim()
      : '';

    return {
      actorDid: proofActorDid || String(job?.content?.iss || '').trim() || undefined,
      bearerPayload: normalizedBearerPayload,
    };
  }

  private assertControllerProofBearerTenantBinding(
    bearerPayload: Record<string, unknown> | undefined,
    tenantConfig: OrganizationConfig,
  ): void {
    if (!bearerPayload || !bearerPayload.vp || typeof bearerPayload.vp !== 'object') {
      return;
    }

    const verifiableCredentials = Array.isArray((bearerPayload.vp as any).verifiableCredential)
      ? (bearerPayload.vp as any).verifiableCredential
      : [];
    const representativeCredential = verifiableCredentials.find((credential: any) => {
      return Boolean(extractRepresentativeMemberOfLegalIdentifier(credential));
    });
    if (!representativeCredential) {
      throw new ManagerError(
        'Controller proof bearer must include one legal representative credential with a typed memberOf identifier for tenant lifecycle.',
        IssueType.Forbidden,
      );
    }

    const targetIdentifier = {
      type: tenantConfig.claims?.[ClaimsOrganizationSchemaorg.identifierType],
      value: tenantConfig.claims?.[ClaimsOrganizationSchemaorg.identifierValue],
    };
    if (!legalOrganizationIdentifiersMatch(
      extractRepresentativeMemberOfLegalIdentifier(representativeCredential),
      targetIdentifier,
    )) {
      throw new ManagerError(
        'Controller proof bearer representative memberOf identifier type and complete value must match the tenant legal identifier.',
        IssueType.Forbidden,
      );
    }

  }

  private getNextTenantLifecycleStatus(
    action: TenantLifecycleAction,
    currentStatus: TenantAuthorizationLifecycleStatus,
  ): TenantAuthorizationLifecycleStatus {
    if (action === ACTION_DISABLE) {
      if (currentStatus === 'revoked') {
        throw new ManagerError('Tenant authorization is revoked and cannot be disabled.', IssueType.Conflict);
      }
      if (currentStatus === 'suspended') {
        throw new ManagerError('Tenant authorization is already disabled.', IssueType.Conflict);
      }
      return 'suspended';
    }

    if (currentStatus === 'revoked') {
      throw new ManagerError('Tenant authorization is revoked and cannot be enabled.', IssueType.Conflict);
    }
    if (currentStatus !== 'suspended') {
      throw new ManagerError('Tenant authorization can only be enabled from disabled state.', IssueType.Conflict);
    }
    return 'active';
  }

  private async assertHostLifecycleAllowed(
    action: TenantLifecycleAction,
    hostCollectionName: string,
  ): Promise<void> {
    if (action !== ACTION_DISABLE && action !== ACTION_PURGE) {
      return;
    }

    const hostedTenants = await this.inspectHostedTenantRegistry(hostCollectionName);
    if (hostedTenants.registeredHostedTenants > 0) {
      throw new ManagerError(
        `Host cannot be ${action === ACTION_DISABLE ? 'disabled' : 'purged'} while ${hostedTenants.registeredHostedTenants} hosted tenant registration(s) remain.`,
        IssueType.Conflict,
      );
    }
  }

  private async assertTenantPurgeAllowed(currentStatus: TenantAuthorizationLifecycleStatus): Promise<void> {
    if (currentStatus !== 'suspended') {
      throw new ManagerError('Tenant authorization must be disabled before purge.', IssueType.Conflict);
    }
  }

  private assertNoActiveTenantDescendants(summary: TenantDescendantLifecycleSummary): void {
    if (summary.activeEmployees > 0 || summary.activeIndividuals > 0) {
      throw new ManagerError(
        `Tenant cannot be disabled while active descendants remain: ${summary.activeEmployees} employee(s), ${summary.activeIndividuals} individual(s).`,
        IssueType.Conflict,
      );
    }
  }

  private assertNoUnpurgedTenantDescendants(summary: TenantDescendantLifecycleSummary): void {
    if (summary.unpurgedEmployees > 0 || summary.unpurgedIndividuals > 0) {
      throw new ManagerError(
        `Tenant cannot be purged while descendants remain: ${summary.unpurgedEmployees} employee(s), ${summary.unpurgedIndividuals} individual(s).`,
        IssueType.Conflict,
      );
    }
  }

  private readDescendantKind(entry: BundleEntry): TenantDescendantKind {
    const rawClaims = entry.resource?.meta?.claims || entry.meta?.claims || {};
    const kind = String(
      (entry.resource as any)?.lifecycle?.descendantKind
      || (rawClaims as any)['org.schema.Action.lifecycle.descendantKind']
      || '',
    ).trim().toLowerCase();
    if (kind === 'employees') {
      throw new ManagerError(
        'Employee cleanup must use each Employee lifecycle operation so encrypted records and assigned licenses are handled correctly.',
        IssueType.NotSupported,
      );
    }
    if (kind !== 'individuals') {
      throw new ManagerError("Organization descendant lifecycle requires resource.lifecycle.descendantKind to be 'individuals'.", IssueType.Required);
    }
    return kind;
  }

  private buildLifecycleStatusResponse(
    entry: BundleEntry,
    tenantConfig: OrganizationConfig,
    identifierValue: string,
    status: TenantAuthorizationLifecycleStatus,
    descendants: TenantDescendantLifecycleSummary,
  ): BundleEntry {
    return {
      type: GatewayResponseEntryTypes.OrganizationLifecycleStatus,
      resource: {
        resourceType: ResourceTypesFhirR4.Organization,
        id: tenantConfig.id,
        meta: { claims: entry.resource?.meta?.claims || entry.meta?.claims || {} },
        lifecycle: {
          identifierValue,
          status,
          descendants,
          canDisable: descendants.activeEmployees === 0 && descendants.activeIndividuals === 0,
          canPurge: status === 'suspended'
            && descendants.unpurgedEmployees === 0
            && descendants.unpurgedIndividuals === 0,
        },
      } as any,
      response: { status: String(HttpStatusCodes.Ok) },
    };
  }

  private async tenantCollectionNames(vaultId: string): Promise<string[]> {
    const collectionName = await this.tenantsCacheManager.getCollectionName(vaultId);
    return [...new Set([vaultId, collectionName].filter(Boolean) as string[])];
  }

  private async changeTenantDescendants(
    vaultId: string,
    kind: TenantDescendantKind,
    operation: 'disable' | 'purge',
  ): Promise<void> {
    const individualSectionId = getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL);
    const individualPrefix = getEnvSectionId(`${SUBJECT_SECTION_INDIVIDUAL}_`);
    for (const collectionName of await this.tenantCollectionNames(vaultId)) {
      for (const sectionId of await this.vaultRepository.getAllSections(collectionName)) {
        const matchesKind = sectionId === individualSectionId || sectionId.startsWith(individualPrefix);
        if (!matchesKind) continue;
        const records = await this.vaultRepository.getContainersInSection<any>(collectionName, sectionId);
        for (const record of records) {
          if (this.isRetainedCommunicationRecord(record)) continue;
          if (operation === 'purge') {
            await this.deleteBlobReferences(record);
            await this.vaultRepository.delete(collectionName, String(record.id), sectionId);
          } else {
            const inactive = {
              ...record,
              status: EntityLifecycleStatus.Inactive,
              content: record.content && typeof record.content === 'object'
                ? { ...record.content, status: EntityLifecycleStatus.Inactive }
                : record.content,
            };
            await this.vaultRepository.put(collectionName, [inactive], sectionId);
          }
        }
      }
    }
  }

  private async deleteBlobReferences(value: unknown): Promise<void> {
    const references = this.collectBlobReferences(value);
    for (const reference of references) await this.storageAdapter.delete?.(reference).catch(() => undefined);
  }

  private collectBlobReferences(value: unknown): string[] {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.flatMap((entry) => this.collectBlobReferences(entry));
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [
      ...(typeof nested === 'string' && (key === 'blobRef' || key.endsWith('#hash')) ? [nested] : []),
      ...this.collectBlobReferences(nested),
    ]);
  }

  private async inspectHostedTenantRegistry(
    hostCollectionName: string,
  ): Promise<HostedTenantRegistrySummary> {
    const tenantRecords = await this.vaultRepository.listContainersInSection<any>(
      hostCollectionName,
      getEnvSectionId('tenants'),
    );
    const registeredHostedTenants = tenantRecords
      .filter((record) => String(record?.id || '').trim() && String(record?.id || '').trim() !== 'host')
      .length;
    return { registeredHostedTenants };
  }

  private async inspectTenantDescendants(vaultId: string): Promise<TenantDescendantLifecycleSummary> {
    const employeeSectionId = getEnvSectionId('employees');
    const baseIndividualSectionId = getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL);
    const subjectSectionPrefix = getEnvSectionId(`${SUBJECT_SECTION_INDIVIDUAL}_`);
    const tenantCollectionName = await this.tenantsCacheManager.getCollectionName(vaultId);
    const collectionNames = [...new Set([vaultId, tenantCollectionName].filter(Boolean) as string[])];
    const summary: TenantDescendantLifecycleSummary = {
      activeEmployees: 0,
      activeIndividuals: 0,
      unpurgedEmployees: 0,
      unpurgedIndividuals: 0,
    };
    const seenRecordKeys = new Set<string>();

    for (const collectionName of collectionNames) {
      const sectionIds = await this.vaultRepository.getAllSections(collectionName);
      for (const sectionId of sectionIds) {
        const isEmployeeSection = sectionId === employeeSectionId;
        const isBaseIndividualSection = sectionId === baseIndividualSectionId;
        const isSubjectLifecycleSection = sectionId.startsWith(subjectSectionPrefix);
        if (!isEmployeeSection && !isBaseIndividualSection && !isSubjectLifecycleSection) {
          continue;
        }

        const records = await this.vaultRepository.listContainersInSection<any>(collectionName, sectionId);
        for (const record of records) {
          const recordKey = `${collectionName}:${sectionId}:${String(record?.id || '')}`;
          if (seenRecordKeys.has(recordKey)) {
            continue;
          }
          seenRecordKeys.add(recordKey);

          const lifecycleRecord = this.readTenantLifecycleRecord(record);
          if (!lifecycleRecord) {
            continue;
          }
          if (!isEmployeeSection && this.isRetainedCommunicationRecord(lifecycleRecord)) {
            continue;
          }
          if (isEmployeeSection && this.isAuxiliaryEmployeeSectionRecord(lifecycleRecord)) {
            continue;
          }
          if (isEmployeeSection && this.isBootstrapControllerLifecycleRecord(collectionName, tenantCollectionName, vaultId, lifecycleRecord)) {
            continue;
          }

          const isActive = String(lifecycleRecord.status || '').trim().toLowerCase() !== EntityLifecycleStatus.Inactive;
          const isPurged = this.isPurgedTenantLifecycleRecord(lifecycleRecord);
          if (isEmployeeSection) {
            if (isActive) summary.activeEmployees += 1;
            if (!isPurged) summary.unpurgedEmployees += 1;
            continue;
          }

          if (isActive) summary.activeIndividuals += 1;
          if (!isPurged) summary.unpurgedIndividuals += 1;
        }
      }
    }

    return summary;
  }

  private readTenantLifecycleRecord(
    record: any,
  ): Record<string, any> | undefined {
    if (!record || typeof record !== 'object') {
      return undefined;
    }
    return record as Record<string, any>;
  }

  private isPurgedTenantLifecycleRecord(record: Record<string, any>): boolean {
    const audit = (record.audit || {}) as Record<string, any>;
    return String(audit.disposition || '').trim().toLowerCase() === PURGED_LIFECYCLE_DISPOSITION;
  }

  /** Retained communications are governed separately and never block tenant cleanup. */
  private isRetainedCommunicationRecord(record: Record<string, any>): boolean {
    const content = record.content && typeof record.content === 'object' ? record.content : {};
    return [record.type, record.resourceType, content.type, content.resourceType]
      .some((value) => String(value || '').trim().toLowerCase() === 'communication');
  }

  /**
   * Employee sections may contain auxiliary included resources persisted next to
   * the real employee container, such as `Occupation`.
   *
   * Those records are not first-class employee lifecycle subjects and must not
   * block tenant disable/purge.
   */
  private isAuxiliaryEmployeeSectionRecord(record: Record<string, any>): boolean {
    const resourceType = String(record.type || '').trim();
    return resourceType.length > 0 && resourceType !== 'Person';
  }

  /**
   * Returns true for the synthetic bootstrap controller employee that hosting
   * creates only as a technical onboarding helper.
   *
   * Why this check uses both record content and collection origin:
   * - legacy hosted-tenant activation stores the bootstrap controller in the
   *   physical tenant collection derived from claims (`tenantCollectionName`)
   * - ordinary employee lifecycle records are written later under the logical
   *   tenant vault collection (`vaultId`)
   * - tenant disable/purge must not be blocked by the technical bootstrap
   *   controller that exists only to complete onboarding
   *
   * This keeps lifecycle scans lightweight:
   * - first prefer an explicit runtime projection marker when present
   * - otherwise fall back to the current storage split used by hosted-tenant
   *   bootstrap (`collectionName === tenantCollectionName && collectionName !== vaultId`)
   */
  private isBootstrapControllerLifecycleRecord(
    collectionName: string,
    tenantCollectionName: string | undefined,
    vaultId: string,
    record: Record<string, any>,
  ): boolean {
    const publicProjection = (record.public || {}) as Record<string, any>;
    if (String(publicProjection.role || '').trim() === HOST_BOOTSTRAP_CONTROLLER_LIFECYCLE_ROLE) {
      return true;
    }
    return Boolean(tenantCollectionName)
      && collectionName === tenantCollectionName
      && collectionName !== vaultId;
  }
}
