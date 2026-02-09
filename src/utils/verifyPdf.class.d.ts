export class VerifyPdf {
  getSignature(pdf: Buffer): { signature: string; signedData: Buffer };
  verify(pdf: Buffer): void;
}
