import { ManageAsset } from './manageAsset';
import { EmployeeIdentityChaincode } from '../../../utils/ledger';

/** Fabric wrapper for the professional-assignment records owned by employee-sc. */
export class ManageAssetProfessionalAssignment extends ManageAsset {
  constructor(options: { channelName: string }) {
    super('professionalAssignment', {
      chaincodeName: EmployeeIdentityChaincode,
      channelName: options.channelName,
    });
  }

  protected override getReadFunction(): string { return 'getProfessionalAssignment'; }

  protected override getHistoryFunction(): string { return 'getProfessionalAssignmentHistory'; }

  public async upsertProfessionalAssignment(
    mspId: string,
    assignmentLink: string,
    payload: object,
  ): Promise<object> {
    return this.submit(
      mspId,
      'UpsertProfessionalAssignment',
      assignmentLink,
      JSON.stringify(payload),
    );
  }
}
