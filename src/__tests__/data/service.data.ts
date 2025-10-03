import { ClaimsServiceSchemaorg } from "../../models/schemaorg";
import { testBaseDataHost, testBaseDataTenant1 } from "./organization.data";

// Terms of service accepted for running the software service
export const testServiceTermsClaimsForHost = {
    [ClaimsServiceSchemaorg.category]: testBaseDataHost.provider.service.sectorCategory, // sector type
    [ClaimsServiceSchemaorg.identifier]: testBaseDataHost.provider.service.identifier,
    [ClaimsServiceSchemaorg.termsOfService]: testBaseDataHost.provider.service.termsOfService,
    [ClaimsServiceSchemaorg.serviceType]: testBaseDataHost.provider.service.serviceTypePurpose,
}

// Terms of service accepted by the tenant's registrant (the `admin` or tenant's `controller`)
export const testServiceTermsClaimsForTenant1 = {
    [ClaimsServiceSchemaorg.category]: testBaseDataTenant1.provider.service.sectorCategory, // sector type
    [ClaimsServiceSchemaorg.identifier]: testBaseDataTenant1.provider.service.identifier,
    [ClaimsServiceSchemaorg.termsOfService]: testBaseDataTenant1.provider.service.termsOfService,
    [ClaimsServiceSchemaorg.serviceType]: testBaseDataTenant1.provider.service.serviceTypePurpose,
}