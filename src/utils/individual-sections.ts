import { createHash } from 'crypto';
import { getEnvSectionId } from './section-env';

/**
 * Builds a Firestore/SQL-safe section id for storing per-individual data inside a tenant vault.
 *
 * Rationale:
 * - Firestore collection/document ids must not contain `/`.
 * - Some identifiers (e.g., did:web) are long and include `:` and other punctuation.
 * - We want stable, deterministic section ids without leaking the full subject identifier.
 */
export function getIndividualSectionId(subjectDid: string, section: string): string {
  return getSubjectScopedSectionId(subjectDid, 'individual', section);
}

export type SubjectSectionScope = 'individual' | 'digitaltwin';

export function getSubjectScopedSectionId(subjectDid: string, scope: SubjectSectionScope, section: string): string {
  const normalized = (subjectDid || '').trim();
  if (!normalized) throw new Error('subjectDid is required');
  if (!scope || !scope.trim()) throw new Error('scope is required');
  if (!section || !section.trim()) throw new Error('section is required');

  const subjectHash = createHash('sha256').update(normalized, 'utf8').digest('hex');
  const normalizedSection = section
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return getEnvSectionId(`${scope.toLowerCase()}_${normalizedSection}_${subjectHash}`);
}

/**
 * Single-section dictionary convention (B1):
 * store all dictionary containers for an individual in one section.
 */
export function getIndividualDictionarySectionId(subjectDid: string): string {
  const normalized = (subjectDid || '').trim();
  if (!normalized) throw new Error('subjectDid is required');
  const subjectHash = createHash('sha256').update(normalized, 'utf8').digest('hex');
  return getEnvSectionId(`individual_dictionary_${subjectHash}`);
}
