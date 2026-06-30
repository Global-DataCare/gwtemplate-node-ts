import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';

function readScopeTokens(scope: unknown): string[] {
  return String(scope || '')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function hasRootCapability(tokens: string[], expected: string): boolean {
  const normalizedExpected = expected.toLowerCase();
  return tokens.some((token) => token.toLowerCase().startsWith(normalizedExpected));
}

export function enforceSmartScopeRouteCompatibility(input: {
  section: string;
  bearerPayload?: Record<string, unknown>;
}): void {
  const section = String(input.section || '').trim().toLowerCase();
  if (section !== 'individual' && section !== 'digitaltwin') return;

  const scopeTokens = readScopeTokens(input.bearerPayload?.scope);
  if (scopeTokens.length === 0) return;

  if (section === 'individual' && !hasRootCapability(scopeTokens, 'organization/composition.')) {
    throw new ManagerError(
      'Individual endpoints require one SMART scope rooted at organization/Composition.',
      IssueType.Forbidden,
    );
  }

  if (section === 'digitaltwin' && !hasRootCapability(scopeTokens, 'organization/researchsubject.')) {
    throw new ManagerError(
      'digitaltwin endpoints require one SMART scope rooted at organization/ResearchSubject.',
      IssueType.Forbidden,
    );
  }
}
