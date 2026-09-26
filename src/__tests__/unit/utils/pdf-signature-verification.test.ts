// Flow contract: PDF verification delegates to a registered adapter and fails closed when none exists.
// pdf-signature-verification.test.ts
// TDD: PDF signature verification for patient/representative consent
import { PdfSignatureVerificationManager, BasicPdfSignatureVerifierAdapter, PdfVerifySubmission } from '../../../utils/pdf-signature-verification';

describe('PdfSignatureVerificationManager', () => {
  it('verifies a sample PDF (simulated) and returns signer and signingTime', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4\n%EOF', 'utf8');
    const submission: PdfVerifySubmission = {
      pdfBytes,
      contentType: 'application/pdf',
    };
    const manager = new PdfSignatureVerificationManager([
      new BasicPdfSignatureVerifierAdapter(),
    ]);
    const result = await manager.verify(submission);
    expect(result.ok).toBe(true);
    expect(result.signer).toBeDefined();
    expect(result.signingTime).toBeDefined();
    expect(result.notes?.[0]).toMatch(/Demo adapter/);
  });

  it('throws if no adapters are registered', async () => {
    const submission: PdfVerifySubmission = {
      pdfBytes: Buffer.from('dummy'),
      contentType: 'application/pdf',
    };
    const manager = new PdfSignatureVerificationManager([]);
    await expect(manager.verify(submission)).rejects.toThrow(/No PDF signature verification adapters/);
  });
});

// Documentación de contrato esperado:
// - submission.pdfBytes: Buffer con el PDF firmado (aceptación de términos)
// - result.signer: identificador del firmante (persona/controller)
// - result.signingTime: fecha/hora de la firma
// - result.ok: true si la verificación es exitosa
// - result.notes: detalles de la verificación
// Este test es base para forking y adaptar a flows reales de consentimiento paciente/representante.
