import { DataCollectionIds, HealthcareBasicSections, ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/index';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { buildFhirResourceFromIndexedClaims } from './fhir-resource-rehydration';
import { getClaimValue } from './claims';
import { getSubjectScopedSectionId, SubjectSectionScope } from './individual-sections';
import { determineResourceId } from './resource';
import {
  extractTokenCode,
  normalizeReference,
  pickLatestIsoDate,
  resolveBundleEntryFullUrl,
  resolveBundleEntryKey,
  tokenToCoding,
} from './fhir-data-utils';
import { TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG } from '../managers/TwinCompositionManager';
import { canonicalizeFhirClaims } from './claims';
import { SupportedFhirIngestionFormat } from './fhir-ingestion';
import { randomUUID } from 'crypto';
import { Format } from 'gdc-common-utils-ts/constants/Schemas';
import { CompositionClaim } from 'gdc-common-utils-ts/models/interoperable-claims/composition-claims';
import {
  FhirIpsCreatorKinds,
  buildFhirIpsCreatorAuthor,
  resolveClinicalCreatorBinding,
  type ClinicalCreatorBinding,
} from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import { getClinicalCreatorBindingsSectionId } from './clinical-creator-binding';
export { getClinicalCreatorBindingsSectionId } from './clinical-creator-binding';

type BuildConsolidatedIpsBundleDocumentParams = {
  vaultRepository: IVaultRepository;
  tenantVaultId: string;
  subject: string;
  scope: SubjectSectionScope;
  requiredSections: string[];
  excludedSections: string[];
  requiredTypes: string[];
};

function ensureSection(sectionRefs: Map<string, Set<string>>, sectionToken: string): void {
  if (!sectionRefs.has(sectionToken)) {
    sectionRefs.set(sectionToken, new Set<string>());
  }
}

function addSectionReference(sectionRefs: Map<string, Set<string>>, sectionToken: string, reference: string): void {
  ensureSection(sectionRefs, sectionToken);
  sectionRefs.get(sectionToken)!.add(reference);
}

function matchesRequiredTypes(actualType: string, requiredTypes: string[]): boolean {
  if (!requiredTypes.length) return true;
  const actualCode = extractTokenCode(actualType);
  return requiredTypes.some((requiredType) => extractTokenCode(requiredType) === actualCode);
}

function belongsToSection(
  record: Record<string, any>,
  sectionToken: string,
  allowImplicitMembership: boolean,
): boolean {
  const expected = extractTokenCode(sectionToken).toLowerCase();
  const memberships = String(
    getClaimValue<string>(record, 'Composition.section') || '',
  )
    .split(',')
    .map((value) => extractTokenCode(value).toLowerCase())
    .filter(Boolean);
  // A legacy single-section ingestion stored the resource in the section's
  // dedicated collection without repeating Composition.section. That is
  // unambiguous only while reconstructing exactly one Composition section.
  if (memberships.length === 0) return allowImplicitMembership;
  return memberships.includes(expected);
}

export async function buildConsolidatedIpsBundleDocument(
  params: BuildConsolidatedIpsBundleDocumentParams,
): Promise<Record<string, any>> {
  const compositionSectionId = getSubjectScopedSectionId(params.subject, params.scope, 'composition');
  const compositionRecords = await params.vaultRepository.listContainersInSection(params.tenantVaultId, compositionSectionId);

  const sectionRefs = new Map<string, Set<string>>();
  const bundleEntries = new Map<string, { fullUrl?: string; resource: Record<string, any> }>();
  const authorRefs = new Set<string>();
  const attesters = new Map<string, { mode?: string; time?: string }>();
  const compositionDates: string[] = [];
  const includedSectionTokens = new Set<string>();

  for (const compositionRecord of compositionRecords as Array<Record<string, any>>) {
    const compositionType = String(
      getClaimValue<string>(compositionRecord, 'Composition.type') || '',
    ).trim();
    if (!matchesRequiredTypes(compositionType, params.requiredTypes)) continue;

    const sectionTokens = String(
      getClaimValue<string>(compositionRecord, 'Composition.section') || '',
    ).split(',').map((value) => value.trim()).filter(Boolean);
    for (const sectionToken of sectionTokens) {
      if (params.excludedSections.includes(sectionToken)) continue;
      if (params.requiredSections.length > 0 && !params.requiredSections.includes(sectionToken)) continue;
      includedSectionTokens.add(sectionToken);
      ensureSection(sectionRefs, sectionToken);
    }

    for (const authorReference of String(
      getClaimValue<string>(compositionRecord, CompositionClaim.Author) || '',
    ).split(',').map(normalizeReference).filter((reference): reference is string => Boolean(reference))) {
      authorRefs.add(authorReference);
    }
    const attesterReferences = String(
      getClaimValue<string>(compositionRecord, CompositionClaim.Attester) || '',
    ).split(',').map(normalizeReference).filter((reference): reference is string => Boolean(reference));
    const attesterModes = String(
      getClaimValue<string>(compositionRecord, CompositionClaim.AttesterMode) || '',
    ).split(',').map((value) => value.trim());
    const attesterTimes = String(
      getClaimValue<string>(compositionRecord, CompositionClaim.AttesterTime) || '',
    ).split(',').map((value) => value.trim());
    attesterReferences.forEach((reference, index) => {
      attesters.set(reference, {
        ...(attesterModes[index] ? { mode: attesterModes[index] } : {}),
        ...(attesterTimes[index] ? { time: attesterTimes[index] } : {}),
      });
    });
    const compositionDate = normalizeReference(getClaimValue<string>(compositionRecord, 'Composition.date'));
    if (compositionDate) compositionDates.push(compositionDate);
  }

  const allowImplicitSectionMembership = includedSectionTokens.size === 1;
  for (const sectionToken of includedSectionTokens) {
    const projectionConfigs = TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[sectionToken] || [];
    for (const projectionConfig of projectionConfigs) {
      for (const collectionIdSuffix of projectionConfig.collectionIds) {
        const resourceSectionId = getSubjectScopedSectionId(params.subject, params.scope, collectionIdSuffix);
        const resourceRecords = await params.vaultRepository.listContainersInSection(params.tenantVaultId, resourceSectionId);
        for (const resourceRecord of resourceRecords) {
          // Observation and Condition collections are shared by several IPS
          // sections. The resource's own Composition.section claim is the
          // authoritative membership authored during document ingestion.
          if (!belongsToSection(resourceRecord, sectionToken, allowImplicitSectionMembership)) continue;
          const resource = buildFhirResourceFromIndexedClaims(projectionConfig.resourceType, resourceRecord);
          const entryKey = resolveBundleEntryKey(undefined, resource);
          // One identifier is one logical clinical resource. Repeated vault
          // rows are historical storage versions; the latest listed row is
          // the current summary representation.
          bundleEntries.set(entryKey, {
            fullUrl: resolveBundleEntryFullUrl(undefined, { resource }),
            resource,
          });
          addSectionReference(sectionRefs, sectionToken, entryKey);
        }
      }
    }
  }

  const documentReferenceSectionId = getSubjectScopedSectionId(params.subject, params.scope, DataCollectionIds.documentReferences);
  const documentReferenceRecords = await params.vaultRepository.listContainersInSection(params.tenantVaultId, documentReferenceSectionId);
  for (const documentReferenceRecord of documentReferenceRecords) {
    const resource = buildFhirResourceFromIndexedClaims(ResourceTypesFhirR4.DocumentReference, documentReferenceRecord);
    const entryKey = resolveBundleEntryKey(undefined, resource);
    if (!bundleEntries.has(entryKey)) {
      bundleEntries.set(entryKey, {
        fullUrl: resolveBundleEntryFullUrl(undefined, { resource }),
        resource,
      });
    }
  }

  const compositionId = `ips-composition-${determineResourceId(params.subject, process.env.NODE_ENV)}`;
  const compositionIdentifier = `urn:uuid:${compositionId}`;
  const compositionSectionTokens = Array.from(sectionRefs.keys());
  const exportedAuthorRefs = new Set<string>();
  const exportedAttesters = new Map<string, { mode?: string; time?: string }>();
  if (authorRefs.size > 0 || attesters.size > 0) {
    const storedBindings = await params.vaultRepository.listContainersInSection(
      params.tenantVaultId,
      getClinicalCreatorBindingsSectionId(),
    );
    const bindings = (storedBindings as unknown[]).filter(isClinicalCreatorBinding);
    const addBindingEntries = (binding: ClinicalCreatorBinding): void => {
      const creator = binding.kind === FhirIpsCreatorKinds.Professional
        ? buildFhirIpsCreatorAuthor({
            kind: binding.kind,
            actorIdentifier: binding.actorIdentifier,
            authorIdentifier: binding.authorIdentifier,
            organizationReference: binding.ownerIdentifier,
            role: binding.role,
          })
        : binding.kind === FhirIpsCreatorKinds.IndividualMember
          ? buildFhirIpsCreatorAuthor({
              kind: binding.kind,
              actorIdentifier: binding.actorIdentifier,
              authorIdentifier: binding.authorIdentifier,
              subjectReference: binding.ownerIdentifier,
              role: binding.role,
            })
          : buildFhirIpsCreatorAuthor({
              kind: binding.kind,
              actorIdentifier: binding.actorIdentifier,
              authorIdentifier: binding.authorIdentifier,
              subjectReference: binding.ownerIdentifier,
            });
      for (const entry of creator.entries) {
        bundleEntries.set(entry.fullUrl, { fullUrl: entry.fullUrl, resource: { ...entry.resource } });
      }
    };
    const findBinding = (reference: string): ClinicalCreatorBinding | undefined =>
      bindings.find((binding) => binding.authorIdentifier === reference
        || binding.actorDids?.includes(reference));

    for (const operationalAuthor of authorRefs) {
      const binding = findBinding(operationalAuthor)
        || resolveClinicalCreatorBinding(bindings, { actorDid: operationalAuthor });
      if (!binding) {
        exportedAuthorRefs.add(operationalAuthor);
        continue;
      }
      const isLegacyOperationalAuthor = binding.actorDids?.includes(operationalAuthor);
      exportedAuthorRefs.add(isLegacyOperationalAuthor ? binding.authorIdentifier : operationalAuthor);
      addBindingEntries(binding);
    }
    for (const [attesterReference, details] of attesters) {
      const binding = findBinding(attesterReference);
      const canonicalReference = binding?.authorIdentifier || attesterReference;
      exportedAttesters.set(canonicalReference, details);
      if (binding) addBindingEntries(binding);
    }
  }
  const compositionClaims: Record<string, any> = {
    '@context': Format.FHIR_API,
    'Composition.identifier': compositionIdentifier,
    'Composition.subject': params.subject,
    'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
    'Composition.date': pickLatestIsoDate(compositionDates),
    'Composition.section': compositionSectionTokens.join(','),
  };
  if (exportedAuthorRefs.size > 0) {
    compositionClaims[CompositionClaim.Author] = Array.from(exportedAuthorRefs).join(',');
  }
  if (exportedAttesters.size > 0) {
    const values = Array.from(exportedAttesters.entries());
    compositionClaims[CompositionClaim.Attester] = values.map(([reference]) => reference).join(',');
    compositionClaims[CompositionClaim.AttesterMode] = values.map(([, value]) => value.mode || '').join(',');
    compositionClaims[CompositionClaim.AttesterTime] = values.map(([, value]) => value.time || '').join(',');
  }
  const compositionResource: Record<string, any> = {
    resourceType: ResourceTypesFhirR4.Composition,
    id: compositionId,
    identifier: [{ value: compositionIdentifier }],
    status: 'final',
    meta: {
      claims: compositionClaims,
    },
    type: {
      coding: [{
        system: HealthcareBasicSections.PatientSummaryDocument.system,
        code: HealthcareBasicSections.PatientSummaryDocument.code,
        display: 'Patient summary Document',
      }],
    },
    subject: { reference: params.subject },
    date: compositionClaims['Composition.date'],
    title: 'International Patient Summary',
    section: compositionSectionTokens.map((sectionToken) => ({
      code: {
        coding: [tokenToCoding(sectionToken)],
      },
      entry: Array.from(sectionRefs.get(sectionToken) || []).map((reference) => ({ reference })),
    })),
    ...(exportedAuthorRefs.size > 0 ? {
      author: Array.from(exportedAuthorRefs).map((reference) => ({ reference })),
    } : {}),
    ...(exportedAttesters.size > 0 ? {
      attester: Array.from(exportedAttesters.entries()).map(([reference, value]) => ({
        ...(value.mode ? { mode: value.mode } : {}),
        ...(value.time ? { time: value.time } : {}),
        party: { reference },
      })),
    } : {}),
  };

  return {
    resourceType: ResourceTypesFhirR4.Bundle,
    type: 'document',
    entry: [
      {
        fullUrl: compositionIdentifier,
        resource: compositionResource,
      },
      ...Array.from(bundleEntries.entries()).map(([reference, entry]) => ({
        fullUrl: entry.fullUrl || reference,
        resource: entry.resource,
      })),
    ],
  };
}

function isClinicalCreatorBinding(value: unknown): value is ClinicalCreatorBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.kind === 'string'
    && typeof record.actorIdentifier === 'string'
    && typeof record.authorIdentifier === 'string'
    && typeof record.ownerIdentifier === 'string'
    && typeof record.role === 'string';
}

export function projectSummaryBundleByFormat(
  bundle: Record<string, any>,
  format: SupportedFhirIngestionFormat,
): Record<string, any> {
  if (format !== 'org.hl7.fhir.api') {
    return bundle;
  }

  return {
    resourceType: ResourceTypesFhirR4.Bundle,
    type: bundle.type || 'document',
    entry: Array.isArray(bundle.entry)
      ? bundle.entry.map((entry: any) => {
        const resource = entry?.resource || {};
        const claims = resource?.meta?.claims && typeof resource.meta.claims === 'object'
          ? canonicalizeFhirClaims(resource.meta.claims as Record<string, any>)
          : {};
        const isComposition = resource?.resourceType === ResourceTypesFhirR4.Composition;
        return {
          fullUrl: String(entry?.fullUrl || '').trim() || `urn:uuid:${String(resource?.id || randomUUID())}`,
          resource: {
            resourceType: String(resource?.resourceType || 'Resource'),
            id: String(resource?.id || ''),
            meta: {
              claims,
            },
            // The API projection remains claims-first for clinical entries,
            // but a document Composition must retain its native graph so the
            // SDK can resolve section references without a second query.
            ...(isComposition ? {
              status: resource.status,
              type: resource.type,
              subject: resource.subject,
              date: resource.date,
              title: resource.title,
              section: resource.section,
              author: resource.author,
            } : {}),
          },
        };
      })
      : [],
  };
}
