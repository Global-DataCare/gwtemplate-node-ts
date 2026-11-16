import type { ITenantsManager } from './ITenantsManager';
import type { FederatedSmartVerificationManager } from './FederatedSmartVerificationManager';
import type { GaiaXComplianceService } from '../services/GaiaXComplianceService';
import { getTenantVaultId } from '../utils/tenant';

/** Authenticates the calling client before using the tenant's server-selected GXDCH. */
export class GaiaXComplianceManager {
  constructor(private readonly tenants: ITenantsManager,
    private readonly clients: Pick<FederatedSmartVerificationManager, 'verifyRegisteredClientAssertion'>,
    private readonly compliance: GaiaXComplianceService) {}

  async verify(input: { tenantId: string; jurisdiction: string; sector: string; vpToken: string;
    clientAssertion: string; clientAssertionType: string; requestUrl: string }) {
    if (input.clientAssertionType !== 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer') throw new Error('GXDCH submission requires private_key_jwt authentication.');
    const tenantVaultId = getTenantVaultId(input.sector, input.tenantId);
    if (!await this.tenants.tenantExists(tenantVaultId) || !await this.tenants.isTenantOperational(tenantVaultId)) throw new Error('GXDCH submission tenant does not exist.');
    const tenantDid = (await this.tenants.getDidDocument(tenantVaultId))?.id;
    if (!tenantDid) throw new Error('GXDCH submission tenant identity is unavailable.');
    await this.clients.verifyRegisteredClientAssertion({ compact: input.clientAssertion, requestUrl: input.requestUrl, tenantDid, tenantVaultId });
    return this.compliance.verifyPresentation({ tenantDid, tenantVaultId, vpToken: input.vpToken });
  }
}
