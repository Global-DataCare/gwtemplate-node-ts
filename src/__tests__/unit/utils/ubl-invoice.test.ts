import { readFileSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { hashUblInvoiceXml } from '../../../utils/ubl-invoice';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('UBL Invoice (EN 16931) validation + hash', () => {
  const xmlPath = path.resolve(__dirname, '../../data/ubl-invoice-minimal.xml');
  const schemaPath = process.env.PEPPOL_INVOICE_XSD;

  it('computes a stable hash for anchoring', () => {
    const xml = readFileSync(xmlPath, 'utf8');
    const { hashHex, hashAlgo } = hashUblInvoiceXml(xml);
    expect(hashAlgo).toBe('sha256');
    expect(hashHex).toMatch(/^[a-f0-9]{64}$/);
  });

  const shouldValidate = schemaPath && schemaPath.length > 0;
  const validationTest = shouldValidate ? it : it.skip;

  validationTest('validates against EN 16931 XSD schema', () => {
    const xml = readFileSync(xmlPath, 'utf8');
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'ubl-'));
    const tmpXml = path.join(tmpDir, 'invoice.xml');
    writeFileSync(tmpXml, xml, 'utf8');

    const result = spawnSync('xmllint', ['--noout', '--schema', schemaPath as string, tmpXml], {
      encoding: 'utf8',
    });

    if (result.error && (result.error as any).code === 'ENOENT') {
      throw new Error('xmllint not found. Install libxml2 or provide a validator.');
    }

    expect(result.status).toBe(0);
  });
});
