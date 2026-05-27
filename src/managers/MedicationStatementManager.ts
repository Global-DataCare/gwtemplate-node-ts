import { randomUUID } from 'crypto';
import { IJobProcessor } from './registry';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { createOperationOutcome } from '../utils/outcome';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { determineResourceId } from '../utils/resource';
import { getTenantVaultId } from '../utils/tenant';
import { getSubjectScopedSectionId, SubjectSectionScope } from '../utils/individual-sections';
import { SUBJECT_SECTION_DIGITAL_TWIN, SUBJECT_SECTION_INDIVIDUAL } from '../constants/domain';

type FhirBundleEntryLike = {
  type?: string;
  meta?: { claims?: Record<string, any> };
  resource?: any;
};

type FhirBundleLike = {
  resourceType?: string;
  type?: string;
  entry?: FhirBundleEntryLike[];
};

export class MedicationStatementManager implements IJobProcessor {
  constructor(private readonly vaultRepository: IVaultRepository) {}

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content?.thid as string | undefined;
    if (!thid) throw new ManagerError('Missing thid.', IssueType.Required);
    const normalizedSection = String(job.section || '').trim().toLowerCase();
    const normalizedAction = String(job.action || '').trim();
    const jurisdiction = String(job.jurisdiction || '').trim();
    if (!job.tenantId || !job.sector) {
      throw new ManagerError('Missing tenantId or sector.', IssueType.Required);
    }
    if (!jurisdiction || !normalizedSection || !normalizedAction) {
      throw new ManagerError('Missing jurisdiction, section, or action.', IssueType.Required);
    }
    if (normalizedSection !== SUBJECT_SECTION_INDIVIDUAL && normalizedSection !== SUBJECT_SECTION_DIGITAL_TWIN) {
      throw new ManagerError(`Unsupported section '${normalizedSection}'.`, IssueType.NotSupported);
    }
    if (normalizedAction !== '_batch' && normalizedAction !== '_search') {
      throw new ManagerError(`Unsupported action '${normalizedAction}' for MedicationStatement.`, IssueType.NotSupported);
    }

    const scope: SubjectSectionScope =
      normalizedSection === SUBJECT_SECTION_DIGITAL_TWIN ? SUBJECT_SECTION_DIGITAL_TWIN : SUBJECT_SECTION_INDIVIDUAL;
    const bundle = (job.content?.body || {}) as any;
    const entries: FhirBundleEntryLike[] =
      (bundle as FhirBundleLike).entry ||
      (bundle?.data as any[]) ||
      [];
    const responseEntries: any[] = [];

    if (normalizedAction === '_batch') {
      for (const entry of entries) {
        const rawClaims = entry?.meta?.claims;
        try {
          if (!rawClaims || typeof rawClaims !== 'object') {
            throw new ManagerError('Missing meta.claims in MedicationStatement entry.', IssueType.Required);
          }
          const claims = normalizeContextualizedClaims(rawClaims);
          const subject =
            getClaimValue<string>(claims, 'MedicationStatement.subject') ||
            getClaimValue<string>(claims, 'MedicationStatement.patient');
          if (!subject) {
            throw new ManagerError('Missing MedicationStatement.subject claim.', IssueType.Required);
          }

          const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
          const tenantExists = await this.vaultRepository.vaultExists(tenantVaultId);
          if (!tenantExists) throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);

          const identifierClaim =
            getClaimValue<string>(claims, 'MedicationStatement.identifier') ||
            getClaimValue<string>(claims, 'MedicationStatement.identifier.value');
          const id = String(entry?.resource?.id || determineResourceId(identifierClaim, process.env.NODE_ENV));
          const sectionId = getSubjectScopedSectionId(subject, scope, 'medications');
          await this.vaultRepository.put(tenantVaultId, [{ id, ...claims } as any], sectionId);

          responseEntries.push({
            type: 'MedicationStatement',
            response: {
              status: '201',
              location: `/${job.tenantId}/cds-${jurisdiction}/v1/${job.sector}/${normalizedSection}/${job.format}/MedicationStatement/_batch-response`,
            },
            meta: { claims },
          });
        } catch (e: any) {
          const status = e instanceof ManagerError ? e.status : '400';
          const code = e instanceof ManagerError ? e.code : IssueType.Invalid;
          responseEntries.push({
            type: 'MedicationStatement',
            meta: { claims: rawClaims || {} },
            response: { status, outcome: createOperationOutcome(IssueLevel.Error, code, e?.message || 'Invalid entry') },
          });
        }
      }
    } else {
      const first = entries[0];
      const rawClaims = first?.meta?.claims || {};
      const claims = normalizeContextualizedClaims(rawClaims as Record<string, any>);
      const subject =
        getClaimValue<string>(claims, 'MedicationStatement.subject') ||
        getClaimValue<string>(claims, 'MedicationStatement.patient');
      if (!subject) {
        throw new ManagerError('Missing MedicationStatement.subject claim for search.', IssueType.Required);
      }

      const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
      const sectionId = getSubjectScopedSectionId(subject, scope, 'medications');
      const where = Object.entries(claims)
        .filter(([k, v]) => k !== '@context' && v !== undefined && v !== null && String(v).trim() !== '')
        .map(([name, value]) => ({ name, value }));
      const matches = await this.vaultRepository.query(tenantVaultId, { sectionId, where });
      responseEntries.push({
        type: 'MedicationStatement-search-response-v1.0',
        resource: { total: matches.length, data: matches },
        response: { status: '200' },
      });
    }

    return {
      jti: randomUUID(),
      type: 'org.hl7.fhir.api.Bundle',
      thid,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: {
        resourceType: 'Bundle',
        type: 'batch-response',
        data: responseEntries,
        total: responseEntries.length,
      },
    };
  }
}
