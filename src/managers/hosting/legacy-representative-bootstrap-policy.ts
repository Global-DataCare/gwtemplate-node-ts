import type { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';

type LegacyControllerScope = Readonly<{
  tenantId: string;
  sector: string;
}>;

function parseScopes(raw: string | undefined): LegacyControllerScope[] {
  const source = String(raw || '').trim();
  if (!source) return [];

  return source.split(',').map((value, index) => {
    const parts = value.split('|').map(part => part.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new ManagerError(
        `Legacy controller scope ${index} must use the '<tenantId>|<sector>' format.`,
        IssueType.Value,
      );
    }
    return { tenantId: parts[0], sector: parts[1] };
  });
}

/**
 * Enables the historical legal-representative controller contract only for an
 * explicitly configured tenant/sector scope. Credential ids, issuers and key
 * ids are deliberately not pinned here: the normal VP/credential trust checks
 * authenticate every submission, while re-registration may renew a credential
 * or rotate that controller's portal key.
 */
export function allowsLegacyRepresentativeBootstrap(input: Readonly<{
  claims: ClaimsRecord;
  representativeCredential?: Record<string, unknown>;
  configuredScopes?: string;
}>): boolean {
  const credential = input.representativeCredential;
  if (!credential) return false;
  const types = (Array.isArray(credential.type) ? credential.type : [credential.type])
    .map(type => String(type || '').trim());
  if (!types.includes('LegalRepresentativeCredential')) return false;

  const tenantId = String(input.claims[ClaimsOrganizationSchemaorg.alternateName] || '').trim();
  const sector = String(input.claims[ClaimsServiceSchemaorg.category] || '').trim();
  return parseScopes(input.configuredScopes).some(scope => scope.tenantId === tenantId && scope.sector === sector);
}
