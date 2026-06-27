import { buildFhirClaimKeys, getFirstClaimValueByKeys } from './claims';

export type DocumentReferenceRecordSearchFilters = {
  identifier?: string;
  attachmentHash?: string;
};

export function filterDocumentReferenceMatches(
  matches: any[],
  filters: DocumentReferenceRecordSearchFilters,
): any[] {
  if (!Array.isArray(matches)) return [];
  const requiredIdentifier = String(filters.identifier || '').trim();
  const requiredAttachmentHash = String(filters.attachmentHash || '').trim();
  if (!requiredIdentifier && !requiredAttachmentHash) return matches;

  return matches.filter((record: any) => {
    const identifier = String(getFirstClaimValueByKeys(record, buildFhirClaimKeys('DocumentReference.identifier')) || '').trim();
    const attachmentHash = String(getFirstClaimValueByKeys(record, buildFhirClaimKeys('DocumentReference.contenthash')) || '').trim();

    if (requiredIdentifier && identifier !== requiredIdentifier) return false;
    if (requiredAttachmentHash && attachmentHash !== requiredAttachmentHash) return false;
    return true;
  });
}

export function filterCompositionMatchesBySectionsAndTypes(
  matches: any[],
  requiredSections: string[],
  excludedSections: string[],
  requiredTypes: string[],
): any[] {
  if (!Array.isArray(matches)) return [];
  const hasSectionFilter = Array.isArray(requiredSections) && requiredSections.length > 0;
  const hasExcludedSectionFilter = Array.isArray(excludedSections) && excludedSections.length > 0;
  const hasTypeFilter = Array.isArray(requiredTypes) && requiredTypes.length > 0;
  if (!hasSectionFilter && !hasExcludedSectionFilter && !hasTypeFilter) return matches;

  const requiredSectionSet = new Set(requiredSections.map((s) => String(s || '').trim()).filter(Boolean));
  const excludedSectionSet = new Set(excludedSections.map((s) => String(s || '').trim()).filter(Boolean));
  const requiredTypeSet = new Set(requiredTypes.map((s) => String(s || '').trim()).filter(Boolean));

  return matches.filter((record: any) => {
    if (hasSectionFilter || hasExcludedSectionFilter) {
      const sectionValue = String(
        getFirstClaimValueByKeys(record, buildFhirClaimKeys('Composition.section')) || '',
      ).trim();
      if (!sectionValue) return false;
      const gotSections = new Set(sectionValue.split(',').map((v: string) => v.trim()).filter(Boolean));

      if (hasExcludedSectionFilter) {
        for (const excluded of excludedSectionSet) {
          if (gotSections.has(excluded)) {
            return false;
          }
        }
      }

      if (hasSectionFilter) {
        let sectionMatched = false;
        for (const req of requiredSectionSet) {
          if (gotSections.has(req)) {
            sectionMatched = true;
            break;
          }
        }
        if (!sectionMatched) return false;
      }
    }

    if (hasTypeFilter) {
      const typeValue = String(
        getFirstClaimValueByKeys(record, buildFhirClaimKeys('Composition.type')) || '',
      ).trim();
      if (!typeValue) return false;
      const gotTypes = new Set(typeValue.split(',').map((v: string) => v.trim()).filter(Boolean));
      let typeMatched = false;
      for (const req of requiredTypeSet) {
        if (gotTypes.has(req)) {
          typeMatched = true;
          break;
        }
      }
      if (!typeMatched) return false;
    }

    return true;
  });
}
