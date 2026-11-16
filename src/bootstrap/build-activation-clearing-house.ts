import { isLocalDemoSecurityMode } from '../security/runtime-security-policy';
import { ClearingHouseService, type IClearingHouseService } from '../services/ClearingHouseService';
import { IcaActivationVerifier } from '../services/IcaActivationVerifier';

/** First-controller ICA authority is distinct from an enrolled professional's ledger proof. */
export function buildActivationClearingHouse(options: ConstructorParameters<typeof IcaActivationVerifier>[0]): IClearingHouseService {
  return isLocalDemoSecurityMode() ? new ClearingHouseService() : new IcaActivationVerifier(options);
}
