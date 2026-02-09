import { createHash } from 'crypto';

export type ClearingHouseVerificationRequest = {
  vpToken: string;
  presentationSubmission?: any;
  acrValues: string[];
};

export type ClearingHouseVerificationResult = {
  acr: string;
  amr?: string[];
  vpHash?: string;
  ledgerVerified: boolean;
};

export interface IClearingHouseService {
  verifyVpToken(request: ClearingHouseVerificationRequest): Promise<ClearingHouseVerificationResult>;
}

export class ClearingHouseService implements IClearingHouseService {
  async verifyVpToken(request: ClearingHouseVerificationRequest): Promise<ClearingHouseVerificationResult> {
    const mode = (process.env.CLEARING_HOUSE_MODE || 'stub').toLowerCase();
    if (mode !== 'stub') {
      throw new Error(`Clearing House mode not implemented: ${mode}`);
    }

    const vpHash = createHash('sha256').update(request.vpToken, 'utf8').digest('hex');
    return {
      acr: request.acrValues[0],
      amr: ['openid4vp', 'vc'],
      vpHash,
      ledgerVerified: true,
    };
  }
}
