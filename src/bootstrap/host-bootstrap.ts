import { IServerConfig } from '../config';
import { HostingManager } from '../managers/HostingManager';
import { ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';

export async function bootstrapHost(hostingManager: HostingManager, bootConfig: IServerConfig): Promise<void> {
  const hostClaims: ClaimsRecord = {
    [ClaimsOrganizationSchemaorg.identifierType]: bootConfig.host.idType,
    [ClaimsOrganizationSchemaorg.identifierValue]: bootConfig.host.idValue,
    [ClaimsOrganizationSchemaorg.addressCountry]: bootConfig.host.jurisdiction,
    [ClaimsOrganizationSchemaorg.legalName]: bootConfig.host.legalName,
    [ClaimsOrganizationSchemaorg.alternateName]: 'host',
    [ClaimsPersonSchemaorg.email]: bootConfig.host.adminEmail,
    [ClaimsPersonSchemaorg.identifier]: `urn:uuid:${bootConfig.host.adminUid}`,
    [ClaimsPersonSchemaorg.hasOccupation]: bootConfig.host.adminRole,
    [ClaimsServiceSchemaorg.category]: 'system',
    [ClaimsServiceSchemaorg.identifier]: `urn:uuid:${bootConfig.host.idValue}-service`,
    [ClaimsServiceSchemaorg.serviceType]: ServiceCapability.OrganizationRegistryProvider,
  };
  const termsUrl = bootConfig.host.termsUrl;
  if (termsUrl) {
    hostClaims[ClaimsServiceSchemaorg.termsOfService] = termsUrl;
  }

  try {
    await hostingManager.bootstrapHost(hostClaims);
  } catch (error) {
    console.error('[GW-API] FATAL: Host tenant bootstrapping failed.', error);
    throw error;
  }
}
