// Flow contract: build a self-contained, cryptographically signed individual-registration PDF; no external fixture or mocked signature boundary may satisfy this test.
import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';

// Public test material only: this key signs generated fixtures and is never used by a runtime identity.
const TEST_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCV0N96ByS9G9Lh
NraoPs+g/P0fyqQfo/nnysEYB3fXnjwrRol8M3rQm9eOnMdmOwaJbWCJldrTyTfJ
vqgi9icQuHYLb43/rTj/I+MKv0kUo6xBPb1NTpTdbAb1QUNCByzz9KM8mTYkOE7V
Q+8JpCtByrG4zigf9VOyAxGBCdWEg1Yis4Y88BdJdB0U+KH+Ku+EThOdBIjiwfhZ
RhdwwAKk067qeiC5P+KFtF+IIVOshJjCzgrPIUPle+QaE/w1fc6APZYiM7hcXK/6
o9CXhYbRfne4q46hSfJ4SAs3/qtZ71s6eFr2yvf/fvO3Z2uIDl0HNbD67J/DGGiq
qINN3hETAgMBAAECggEAIbfW9EHzVNSUS7fiuE8ar+MAnU0gTza6oh6SAvR7Vn34
kMzZWKjFdXn9s805W5rhR8DkP1MI4y2gbrmIYgYAmNTLTJuY2/iCoXnUObD/o7OK
q0xX9LRA8OzFTCGaH5w509Y1fwgElXZO19ToUcUvLymNgkhz4211ntTt9ZrfAWmt
qElGejbp8Nb8AVsVzWwvaT6uuyEwl501/M1vLeVqItsBbYIgjigZtyKew8B44L7Z
7QpsyBA4dFRFT7gyMXzrDVVHkNv0v46DMjz9AkGl4Cu/Zc4w3voowMfS9ZLuljjV
zzpiziT0zdWq+lbi9/wCHNxxbd6jHtwy+miiEudPwQKBgQDHWA6RRZaNKMlM28oP
QM14qLss728yth+as6oyOiSnwxIDxz3l4LFDCOpBxOC+I+2euuq157FaLt85xlyV
poCE03aW0sOteLgQXPw+/Cs4AzEs2v3MvvLnxCpqa/bHey8ZCkNRxt8oU6QZ395q
/uADSdL0AL2uRY8RIHBid5RCEQKBgQDAZTwdIv4+ojIj6GN0OBtBGVMZ4Z4og6kJ
kxU2sZSnscyzs9pFmgeYl9MBFZE+WdZrFte9sNFo2nTtLqcWahJHcvENb4UMzo0T
Zs5+bJ6DrNiiI6o9XmHgaIDW0bDUeQVD41oJxKGC6N7CYGgJr0cZMgIGoWOnSP6Z
98bSA7O84wKBgQDBViw6xS0xFx+1hW3BwW4G2k8/U7Gbk3uvhRVKxY2Lj+xG8dSc
wYHqrBjXVOVMRHhP/KVra51dBBzIYhSlp+j56kYYHa5e7rhGVojnZZddKetlv7dr
/r6D/oPM141vB5A0TvnftGv3Jrf/yFpll3EYf18z/Av7m8cYK0gUmDmYoQKBgHdb
FmT4/YM7uiFenLxPxlCndk9bEXQO4cIH1iQ9HHzAJ77f96wwN0AqCAPnLljhAM0k
uah7Vh5XUCyIQa39FePvYa21HnRoe0qq/7WciuYjR62mtIkn0U6XZj5ejfXyMhsA
oy3mJ1CASRmLF1/StifiRzF308vG0/QOq/BDzbCDAoGAbSNCGBcHv/ZwenLdgziu
8oUaS8jOGYXS9hGSXLjU+hXxGu8bCQN65Bf5zOK6nv2RURhU3aaZLtx5NwkpZ06N
9bxXvEqZnhZSjRZqp3plGPr0XvQnVIdI1miDibcpASkbmS1Qq6CFi5HyHLAZskhE
sRwREAwB6gDWfG4/X0ZKV1o=
-----END PRIVATE KEY-----`;

const TEST_CERTIFICATE_PEM = `-----BEGIN CERTIFICATE-----
MIIDvTCCAqWgAwIBAgIULjV8nLQILBL8vGoMgC66lHYDKOMwDQYJKoZIhvcNAQEL
BQAwbTELMAkGA1UEBhMCRVMxGDAWBgNVBAUTD0lEQ0VTLTAwMDAwMDAwVDERMA8G
A1UEKgwIR0RDIFRlc3QxEzARBgNVBAQMCkNvbnRyb2xsZXIxHDAaBgNVBAMME0dE
QyBUZXN0IENvbnRyb2xsZXIwIBcNMjYwOTExMjMxMDI3WhgPMjEyNjA4MTgyMzEw
MjdaMG0xCzAJBgNVBAYTAkVTMRgwFgYDVQQFEw9JRENFUy0wMDAwMDAwMFQxETAP
BgNVBCoMCEdEQyBUZXN0MRMwEQYDVQQEDApDb250cm9sbGVyMRwwGgYDVQQDDBNH
REMgVGVzdCBDb250cm9sbGVyMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC
AQEAldDfegckvRvS4Ta2qD7PoPz9H8qkH6P558rBGAd31548K0aJfDN60JvXjpzH
ZjsGiW1giZXa08k3yb6oIvYnELh2C2+N/604/yPjCr9JFKOsQT29TU6U3WwG9UFD
Qgcs8/SjPJk2JDhO1UPvCaQrQcqxuM4oH/VTsgMRgQnVhINWIrOGPPAXSXQdFPih
/irvhE4TnQSI4sH4WUYXcMACpNOu6noguT/ihbRfiCFTrISYws4KzyFD5XvkGhP8
NX3OgD2WIjO4XFyv+qPQl4WG0X53uKuOoUnyeEgLN/6rWe9bOnha9sr3/37zt2dr
iA5dBzWw+uyfwxhoqqiDTd4REwIDAQABo1MwUTAdBgNVHQ4EFgQUBEdkrI9JZHsl
d6dQFHtbntyx2ZAwHwYDVR0jBBgwFoAUBEdkrI9JZHsld6dQFHtbntyx2ZAwDwYD
VR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAivjErnSmoU2NYCQcBZqJ
OKknBCN71R2xmbADRmDXSXdBl4h/S9pkbFxqBdINBPzQPWnEgNDHueg0cZ42Jtmy
y5t70jVZJdjzcQd67QUFxbJITH+VV1HlXg4221XWG8XelwX77+YyC/ul0Co4nMCL
Bm5vHzEGwlzGus/xGtkUMZWOTkZiM0AgWm/zGpT1Qyhp4w8MDYL/jp8/uEP3+oF8
TzeM2JT8PiwkLcLf9X3LrmQT8T/k4VFkbM22RAdB+ZkfQ9U3d9cTnWvTNtRcN194
sMauSufSNw8Nqp8BdgFthjBesmK87hRHz2SKrVeOmKKP/kEWumCGIgtfIu69F1Oq
pg==
-----END CERTIFICATE-----`;

const SIGNATURE_HEX_LENGTH = 16_384;
const FIXED_PDF_DATE = new Date('2026-09-11T00:00:00.000Z');

export const SIGNED_INDIVIDUAL_PDF_EXPECTED = Object.freeze({
  controllerEmail: 'signed.controller@example.org',
  organizationAlternateName: 'Signed Individual Test',
  signerCommonName: 'GDC Test Controller',
  signerGivenName: 'GDC Test',
  signerSurname: 'Controller',
  signerSerialNumber: 'IDCES-00000000T',
  signerCountry: 'ES',
  signerSubjectDn: 'CN=GDC Test Controller,SN=Controller,GN=GDC Test,serialNumber=IDCES-00000000T,C=ES',
});

function fixedWidthOffset(value: number): string {
  return String(value).padStart(10, '0');
}

async function createIndividualRegistrationPdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.setCreationDate(FIXED_PDF_DATE);
  document.setModificationDate(FIXED_PDF_DATE);
  document.setProducer('GW CORE signed individual fixture');
  document.setCreator('GW CORE tests');
  const page = document.addPage([600, 800]);
  const form = document.getForm();

  const alternateName = form.createTextField('controllerAlternateName');
  alternateName.setText(SIGNED_INDIVIDUAL_PDF_EXPECTED.organizationAlternateName);
  alternateName.addToPage(page, { x: 20, y: 740, width: 250, height: 20 });
  const email = form.createTextField('controllerEmail');
  email.setText(SIGNED_INDIVIDUAL_PDF_EXPECTED.controllerEmail);
  email.addToPage(page, { x: 20, y: 700, width: 250, height: 20 });
  const consentDate = form.createTextField('docDate');
  consentDate.setText('2026-09-11');
  consentDate.addToPage(page, { x: 20, y: 660, width: 250, height: 20 });
  const provider = form.createTextField('serviceProviderDomain');
  provider.setText('https://provider.example.org');
  provider.addToPage(page, { x: 20, y: 620, width: 250, height: 20 });
  const self = form.createCheckBox('controllerIsSubject');
  self.addToPage(page, { x: 20, y: 580, width: 20, height: 20 });
  self.check();

  return Buffer.from(await document.save({ useObjectStreams: false }));
}

/** Builds a stable PDF body carrying a real detached PKCS#7 signature and signer certificate. */
export async function buildSignedIndividualPdfFixture(): Promise<Buffer> {
  const pdfBody = await createIndividualRegistrationPdf();
  const placeholder = '0'.repeat(SIGNATURE_HEX_LENGTH);
  const unsignedTailTemplate = `\n/ByteRange[${'0'.repeat(10)} ${'0'.repeat(10)} ${'0'.repeat(10)} ${'0'.repeat(10)}] /Contents <${placeholder}>\n`;
  const placeholderPdf = Buffer.concat([pdfBody, Buffer.from(unsignedTailTemplate, 'latin1')]);
  const signatureStart = placeholderPdf.lastIndexOf(Buffer.from(`<${placeholder}>`, 'latin1'));
  const secondRangeStart = signatureStart + SIGNATURE_HEX_LENGTH + 2;
  const secondRangeLength = placeholderPdf.length - secondRangeStart;
  const byteRange = `/ByteRange[${fixedWidthOffset(0)} ${fixedWidthOffset(signatureStart)} ${fixedWidthOffset(secondRangeStart)} ${fixedWidthOffset(secondRangeLength)}]`;
  const unsignedTail = unsignedTailTemplate.replace(/\/ByteRange\[[^\]]+\]/, byteRange);
  const unsignedPdf = Buffer.concat([pdfBody, Buffer.from(unsignedTail, 'latin1')]);
  const signedData = Buffer.concat([
    unsignedPdf.subarray(0, signatureStart),
    unsignedPdf.subarray(secondRangeStart),
  ]);

  const message = forge.pkcs7.createSignedData();
  message.content = forge.util.createBuffer(signedData.toString('binary'));
  const certificate = forge.pki.certificateFromPem(TEST_CERTIFICATE_PEM);
  message.addCertificate(certificate);
  message.addSigner({
    key: forge.pki.privateKeyFromPem(TEST_PRIVATE_KEY_PEM),
    certificate,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
    ],
  });
  message.sign({ detached: true });

  const signatureHex = forge.asn1.toDer(message.toAsn1()).getBytes().split('')
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
  if (signatureHex.length > SIGNATURE_HEX_LENGTH) {
    throw new Error(`Signed PDF fixture signature exceeds ${SIGNATURE_HEX_LENGTH} hexadecimal characters.`);
  }

  const paddedSignature = signatureHex.padEnd(SIGNATURE_HEX_LENGTH, '0');
  return Buffer.concat([
    unsignedPdf.subarray(0, signatureStart + 1),
    Buffer.from(paddedSignature, 'latin1'),
    unsignedPdf.subarray(secondRangeStart - 1),
  ]);
}
