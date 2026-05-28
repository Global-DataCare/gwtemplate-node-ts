// src/__tests__/managers/FamilyManager.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.

import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { mock, MockProxy } from 'jest-mock-extended';
import { tmpdir } from 'os';
import path from 'path';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { BundleJsonApi, BundleEntry } from 'gdc-common-utils-ts/models/bundle';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { PDFDocument } from 'pdf-lib';
import {
  ClaimsOrganizationSchemaorg,
  ClaimsPersonSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { IStorageAdapter } from '../../database/storage/IStorageAdapter';
import { ILogger } from '../../loggers/ILogger';
import { FamilyManager } from '../../managers/FamilyManager';
import { EntityLifecycleStatus } from '../../gdc-backend-utils-node/models/enums';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { mockKmsService } from '../mocks/kms.mock';
import { buildClaimsFromIndividualFormPdf } from '../../utils/individual-form-pdf';
import { testDefaultTenantServiceTypeClaim } from '../data/organization.data';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const TENANT_ID = 'acme';
const SECTOR = Sector.HEALTH_CARE;
const COLLECTION_NAME = `${SECTOR}_${TENANT_ID}`;
const TENANT_DID = 'did:web:host.example.com';

/**
 * Base set of already-normalized claims (org.schema.<Resource>.<field>) that satisfy
 * the minimum required by FamilyManager.extractResources(): Organization + Service
 * (Person is optional for individual organizations).
 * `termsOfService` is an https URL so handleServiceAttachment skips file upload.
 */
const BASE_CLAIMS: Record<string, unknown> = {
  [ClaimsServiceSchemaorg.category]: SECTOR,
  [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
  [ClaimsOrganizationSchemaorg.identifierType]: 'UUID',
  [ClaimsOrganizationSchemaorg.identifierValue]: randomUUID(),
  [ClaimsOrganizationSchemaorg.ownerEmail]: 'parent@example.com',
  [ClaimsOrganizationSchemaorg.ownerTelephone]: '+34600000001',
  [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: 'IDCES-TEST-CONTROLLER',
  [ClaimsOrganizationSchemaorg.alternateName]: 'Ana',
  [ClaimsPersonSchemaorg.email]: 'child@example.com',
  [ClaimsPersonSchemaorg.identifierType]: 'UUID',
  [ClaimsPersonSchemaorg.identifierValue]: randomUUID(),
  [ClaimsPersonSchemaorg.telephone]: '+34600000001',
  [ClaimsPersonSchemaorg.alternateName]: 'Ana',
  [ClaimsServiceSchemaorg.identifier]: 'did:web:provider.example.com',
  [ClaimsServiceSchemaorg.serviceType]: testDefaultTenantServiceTypeClaim,
  [ClaimsServiceSchemaorg.termsOfService]: 'https://example.com/terms',
};

function makeBatchJob(overrideClaims: Record<string, unknown> = {}): JobRequest {
  return {
    id: randomUUID(),
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: TENANT_ID,
    sector: SECTOR,
    section: 'individual',
    format: 'org.schema',
    action: '_batch',
    resourceType: 'Organization',
    content: {
      jti: randomUUID(),
      thid: randomUUID(),
      iss: 'did:web:client.example.com',
      aud: `did:web:${TENANT_ID}.example.com`,
      type: 'application/api+json',
      body: {
        data: [{
          type: 'Family-registration-form-v1.0',
          meta: { claims: { ...BASE_CLAIMS, ...overrideClaims } },
        }],
      },
    },
  };
}

function makeTransactionJob(
  overrideClaims: Record<string, unknown> = {},
  attachments?: Array<Record<string, unknown>>,
): JobRequest {
  return {
    id: randomUUID(),
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: TENANT_ID,
    sector: SECTOR,
    section: 'individual',
    format: 'org.schema',
    action: '_transaction',
    resourceType: 'Organization',
    content: {
      jti: randomUUID(),
      thid: randomUUID(),
      iss: 'did:web:client.example.com',
      aud: `did:web:${TENANT_ID}.example.com`,
      type: 'application/api+json',
      body: {
        data: [{
          type: 'Family-registration-form-v1.0',
          meta: { claims: { ...BASE_CLAIMS, ...overrideClaims } },
        }],
      },
      ...(attachments ? { attachments } : {}),
    },
  };
}

function makeSearchJob(overrideClaims: Record<string, unknown> = {}): JobRequest {
  return {
    id: randomUUID(),
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: TENANT_ID,
    sector: SECTOR,
    section: 'individual',
    format: 'org.schema',
    action: '_search',
    resourceType: 'Organization',
    content: {
      jti: randomUUID(),
      thid: randomUUID(),
      iss: 'did:web:client.example.com',
      aud: `did:web:${TENANT_ID}.example.com`,
      type: 'application/api+json',
      body: {
        data: [{
          type: 'Family-search-v1.0',
          meta: {
            claims: {
              [ClaimsOrganizationSchemaorg.ownerTelephone]: '+34600000001',
              [ClaimsOrganizationSchemaorg.ownerEmail]: 'parent@example.com',
              [ClaimsOrganizationSchemaorg.alternateName]: 'Ana',
              [ClaimsServiceSchemaorg.category]: SECTOR,
              ...overrideClaims,
            },
          },
        }],
      },
    },
  };
}

function makePurgeJob(overrideClaims: Record<string, unknown> = {}): JobRequest {
  return {
    id: randomUUID(),
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: TENANT_ID,
    sector: SECTOR,
    section: 'individual',
    format: 'org.schema',
    action: '_purge',
    resourceType: 'Organization',
    content: {
      jti: randomUUID(),
      thid: randomUUID(),
      iss: 'did:web:client.example.com',
      aud: `did:web:${TENANT_ID}.example.com`,
      type: 'application/api+json',
      body: {
        data: [{
          type: 'Family-purge-request-v1.0',
          meta: {
            claims: {
              [ClaimsOrganizationSchemaorg.ownerTelephone]: '+34600000001',
              [ClaimsOrganizationSchemaorg.ownerEmail]: 'parent@example.com',
              [ClaimsOrganizationSchemaorg.alternateName]: 'Ana',
              [ClaimsServiceSchemaorg.category]: SECTOR,
              ...overrideClaims,
            },
          },
        }],
      },
    },
  };
}

function makeDisableJob(overrideClaims: Record<string, unknown> = {}): JobRequest {
  return {
    id: randomUUID(),
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: TENANT_ID,
    sector: SECTOR,
    section: 'individual',
    format: 'org.schema',
    action: '_disable',
    resourceType: 'Organization',
    content: {
      jti: randomUUID(),
      thid: randomUUID(),
      iss: 'did:web:client.example.com',
      aud: `did:web:${TENANT_ID}.example.com`,
      type: 'application/api+json',
      body: {
        data: [{
          type: 'Family-disable-request-v1.0',
          meta: {
            claims: {
              [ClaimsOrganizationSchemaorg.ownerTelephone]: '+34600000001',
              [ClaimsOrganizationSchemaorg.ownerEmail]: 'parent@example.com',
              [ClaimsOrganizationSchemaorg.alternateName]: 'Ana',
              [ClaimsServiceSchemaorg.category]: SECTOR,
              ...overrideClaims,
            },
          },
        }],
      },
    },
  };
}

async function extractPdfFormFieldsFromFixture(pdfPath: string): Promise<Record<string, string>> {
  const document = await PDFDocument.load(readFileSync(pdfPath), { ignoreEncryption: true, updateMetadata: false });
  const fields: Record<string, string> = {};
  for (const field of document.getForm().getFields()) {
    const name = field.getName()?.trim();
    if (!name) continue;

    let value = '';
    if (typeof (field as any).getText === 'function') {
      value = String((field as any).getText() || '').trim();
    } else if (typeof (field as any).getSelected === 'function') {
      const selected = (field as any).getSelected();
      value = Array.isArray(selected) ? selected.join(', ').trim() : String(selected || '').trim();
    } else if (typeof (field as any).isChecked === 'function') {
      value = (field as any).isChecked() ? 'true' : 'false';
    }
    if (value) fields[name] = value;
  }
  return fields;
}

function extractNaturalPersonSignerSubjectFromPdf(pdfPath: string): string {
  const pdfBytes = readFileSync(pdfPath);
  const pdfAsLatin1 = pdfBytes.toString('latin1');
  const byteRangeRegex = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  const match = byteRangeRegex.exec(pdfAsLatin1);
  if (!match) {
    throw new Error('Real PDF fixture is missing ByteRange.');
  }

  const [start1, length1, start2] = match.slice(1, 4).map((value) => Number.parseInt(value, 10));
  const signatureWindow = pdfBytes.subarray(start1 + length1, start2);
  const lt = signatureWindow.indexOf(0x3c);
  const gt = signatureWindow.lastIndexOf(0x3e);
  let hex = signatureWindow.subarray(lt + 1, gt).toString('latin1').replace(/[^0-9a-fA-F]/g, '');
  while (hex.endsWith('00')) {
    hex = hex.slice(0, -2);
  }

  const tempDir = mkdtempSync(path.join(tmpdir(), 'gw-family-pdf-fixture-'));
  try {
    const signatureDerPath = path.join(tempDir, 'signature.der');
    const certsPath = path.join(tempDir, 'certs.pem');
    writeFileSync(signatureDerPath, Buffer.from(hex, 'hex'));
    execFileSync('openssl', ['pkcs7', '-inform', 'DER', '-in', signatureDerPath, '-print_certs', '-out', certsPath]);

    const certs = (readFileSync(certsPath, 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []);
    for (const [index, certPem] of certs.entries()) {
      const certPath = path.join(tempDir, `cert-${index}.pem`);
      writeFileSync(certPath, `${certPem}\n`);
      const subject = execFileSync(
        'openssl',
        ['x509', '-in', certPath, '-noout', '-subject', '-nameopt', 'RFC2253'],
        { encoding: 'utf8' },
      ).trim();
      if (/\bserialNumber=IDCES-/i.test(subject)) {
        return subject.replace(/^subject=/i, '');
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  throw new Error('Natural-person signer certificate not found in real PDF fixture.');
}

function getIndividualPdfFixtureConfig(): {
  pdfPath: string;
  expectedSignerSubjectDn: string;
  expectedControllerEmail: string;
  expectedOrganizationAlternateName: string;
  expectedControllerBirthDate?: string;
  expectedControllerGender?: string;
} | null {
  const pdfPath = String(process.env.TEST_INDIVIDUAL_FORM_PDF_PATH || '').trim();
  const cn = String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_CN || '').trim();
  const sn = String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_SN || '').trim();
  const gn = String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_GN || '').trim();
  const serialNumber = String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_SERIALNUMBER || '').trim();
  const country = String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_COUNTRY || '').trim();
  const email = String(process.env.TEST_INDIVIDUAL_CONTROLLER_EMAIL || '').trim().toLowerCase();
  const alternateName = String(process.env.TEST_INDIVIDUAL_ORGANIZATION_ALTNAME || '').trim();
  const birthDate = String(process.env.TEST_INDIVIDUAL_CONTROLLER_BIRTHDATE || '').trim();
  const gender = String(process.env.TEST_INDIVIDUAL_CONTROLLER_GENDER || '').trim();

  if (!pdfPath || !cn || !sn || !gn || !serialNumber || !country || !email || !alternateName) {
    return null;
  }

  return {
    pdfPath,
    expectedSignerSubjectDn: `CN=${cn},SN=${sn},GN=${gn},serialNumber=${serialNumber},C=${country}`,
    expectedControllerEmail: email,
    expectedOrganizationAlternateName: alternateName,
    ...(birthDate ? { expectedControllerBirthDate: birthDate } : {}),
    ...(gender ? { expectedControllerGender: gender } : {}),
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('FamilyManager', () => {
  let manager: FamilyManager;
  let mockVaultRepository: MockProxy<IVaultRepository>;
  let mockStorageAdapter: MockProxy<IStorageAdapter>;
  let mockLogger: MockProxy<ILogger>;
  let mockTenantsCacheManager: jest.Mocked<Pick<TenantsCacheManager, 'getCollectionName' | 'getTenantDid'>>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockVaultRepository = mock<IVaultRepository>();
    mockStorageAdapter = mock<IStorageAdapter>();
    mockLogger = mock<ILogger>();

    mockTenantsCacheManager = {
      getCollectionName: jest.fn().mockResolvedValue(COLLECTION_NAME),
      getTenantDid: jest.fn().mockResolvedValue(TENANT_DID),
    };

    manager = new FamilyManager(
      mockVaultRepository,
      mockKmsService as any,
      mockTenantsCacheManager as unknown as TenantsCacheManager,
      mockStorageAdapter as any,
      mockLogger as any,
      { allowedPaymentMethods: ['Stripe'] } as any,
    );
  });

  // -------------------------------------------------------------------------
  // _batch — processFamilyRegistrationEntry
  // -------------------------------------------------------------------------

  describe('_batch / processFamilyRegistrationEntry', () => {
    it('new_created: stores doc and returns status new_created when vault has no match', async () => {
      mockVaultRepository.query.mockResolvedValue([]);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await manager.process(makeBatchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('new_created');
      expect(entry.response?.status).toBe('201');
      expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
    });

    it('already_exists: returns status already_exists without inserting when Active record is found', async () => {
      const existingContent = {
        status: EntityLifecycleStatus.Active,
        claims: { ...BASE_CLAIMS },
        contained: [],
      };
      mockVaultRepository.query.mockResolvedValue([{ id: 'existing-active-id', jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);

      const response = await manager.process(makeBatchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('already_exists');
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });

    it('resume_required: returns status resume_required without inserting when Pending record is found', async () => {
      const existingContent = {
        status: EntityLifecycleStatus.Pending,
        claims: { ...BASE_CLAIMS },
        contained: [],
      };
      mockVaultRepository.query.mockResolvedValue([{ id: 'existing-pending-id', jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);

      const response = await manager.process(makeBatchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('resume_required');
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });

    it('idempotency query uses owner.telephone + alternateName as composite key', async () => {
      mockVaultRepository.query.mockResolvedValue([]);
      mockVaultRepository.put.mockResolvedValue(true);

      await manager.process(makeBatchJob());

      expect(mockVaultRepository.query).toHaveBeenCalledWith(
        COLLECTION_NAME,
        expect.objectContaining({
          where: expect.arrayContaining([
            expect.objectContaining({ name: ClaimsOrganizationSchemaorg.ownerTelephone, value: 'tel:+34600000001' }),
            expect.objectContaining({ name: ClaimsOrganizationSchemaorg.alternateName, value: 'Ana' }),
          ]),
        }),
      );
    });

    it('individual-form-pdf-cert-signed maps the real signed PDF into valid CORE family claims', async () => {
        const fixture = getIndividualPdfFixtureConfig();
        if (!fixture?.pdfPath || !existsSync(fixture.pdfPath)) {
          return;
        }

        mockVaultRepository.query.mockResolvedValue([]);
        mockVaultRepository.put.mockResolvedValue(true);

        const pdfFields = await extractPdfFormFieldsFromFixture(fixture.pdfPath);
        const signerSubjectDn = extractNaturalPersonSignerSubjectFromPdf(fixture.pdfPath);
        const mapped = buildClaimsFromIndividualFormPdf(pdfFields, signerSubjectDn);

        const response = await manager.process(makeBatchJob({
          [ClaimsOrganizationSchemaorg.ownerTelephone]: '',
          [ClaimsPersonSchemaorg.telephone]: '',
          ...mapped,
        }));
        const body = response.body as BundleJsonApi;
        const entry = body.data[0] as BundleEntry;

        expect(pdfFields.email).toBe(fixture.expectedControllerEmail);
        expect(pdfFields.alternateName).toBe(fixture.expectedOrganizationAlternateName);
        expect(signerSubjectDn).toBe(fixture.expectedSignerSubjectDn);

        expect(mapped).toEqual(expect.objectContaining({
          '@context': 'org.schema',
          [ClaimsOrganizationSchemaorg.alternateName]: fixture.expectedOrganizationAlternateName,
          [ClaimsOrganizationSchemaorg.ownerEmail]: fixture.expectedControllerEmail,
          [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_SERIALNUMBER || '').trim(),
          [ClaimsPersonSchemaorg.email]: fixture.expectedControllerEmail,
          [ClaimsPersonSchemaorg.alternateName]: fixture.expectedOrganizationAlternateName,
          [ClaimsPersonSchemaorg.identifierValue]: String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_SERIALNUMBER || '').trim(),
          [ClaimsOrganizationSchemaorg.addressCountry]: String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_COUNTRY || '').trim(),
        }));
        expect(mapped[ClaimsPersonSchemaorg.givenName]).toBe(String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_GN || '').trim());
        expect(mapped[ClaimsPersonSchemaorg.familyName]).toBe(String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_SN || '').trim());
        expect(mapped[ClaimsPersonSchemaorg.name]).toBe(
          `${String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_GN || '').trim()} ${String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_SN || '').trim()}`.trim(),
        );
        if (fixture.expectedControllerBirthDate) {
          expect(mapped[ClaimsPersonSchemaorg.birthDate]).toBe(fixture.expectedControllerBirthDate);
        }
        if (fixture.expectedControllerGender) {
          expect(mapped[ClaimsPersonSchemaorg.gender]).toBe(fixture.expectedControllerGender);
        }

        expect(entry.meta?.claims).toEqual(expect.objectContaining({
          'org.schema.FamilyRegistration.status': 'new_created',
          [ClaimsOrganizationSchemaorg.alternateName]: fixture.expectedOrganizationAlternateName,
          [ClaimsOrganizationSchemaorg.ownerEmail]: fixture.expectedControllerEmail,
          [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_SERIALNUMBER || '').trim(),
          [ClaimsPersonSchemaorg.identifierValue]: String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_SERIALNUMBER || '').trim(),
        }));
      });

    it('individual-form-pdf attachment flow accepts _transaction alias and completes claims from signed PDF', async () => {
        const fixture = getIndividualPdfFixtureConfig();
        if (!fixture?.pdfPath || !existsSync(fixture.pdfPath)) {
          return;
        }

        mockVaultRepository.query.mockResolvedValue([]);
        mockVaultRepository.put.mockResolvedValue(true);

        const pdfBase64 = readFileSync(fixture.pdfPath).toString('base64');
        const response = await manager.process(makeTransactionJob(
          {
            [ClaimsOrganizationSchemaorg.ownerTelephone]: '',
            [ClaimsPersonSchemaorg.telephone]: '',
            [ClaimsServiceSchemaorg.category]: SECTOR,
            [ClaimsServiceSchemaorg.identifier]: 'did:web:provider.example.com',
            [ClaimsServiceSchemaorg.serviceType]: testDefaultTenantServiceTypeClaim,
            [ClaimsServiceSchemaorg.termsOfService]: 'https://example.com/terms',
          },
          [{
            id: 'signed-individual-form',
            media_type: 'application/pdf',
            data: { base64: pdfBase64 },
          }],
        ));
        const body = response.body as BundleJsonApi;
        const entry = body.data[0] as BundleEntry;

        expect(body.type).toBe('transaction-response');
        expect(entry.meta?.claims).toEqual(expect.objectContaining({
          'org.schema.FamilyRegistration.status': 'new_created',
          [ClaimsOrganizationSchemaorg.alternateName]: fixture.expectedOrganizationAlternateName,
          [ClaimsOrganizationSchemaorg.ownerEmail]: fixture.expectedControllerEmail,
          [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_SERIALNUMBER || '').trim(),
          [ClaimsPersonSchemaorg.identifierValue]: String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_SERIALNUMBER || '').trim(),
        }));
      });

    it('individual-form-pdf attachment flow also accepts HTTPS links[] and downloads the PDF before extracting claims', async () => {
        const fixture = getIndividualPdfFixtureConfig();
        if (!fixture?.pdfPath || !existsSync(fixture.pdfPath)) {
          return;
        }

        mockVaultRepository.query.mockResolvedValue([]);
        mockVaultRepository.put.mockResolvedValue(true);

        const pdfBytes = readFileSync(fixture.pdfPath);
        const fetchSpy = jest.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
          ok: true,
          status: 200,
          arrayBuffer: async () => pdfBytes,
        } as any);

        try {
          const response = await manager.process(makeTransactionJob(
            {
              [ClaimsOrganizationSchemaorg.ownerTelephone]: '',
              [ClaimsPersonSchemaorg.telephone]: '',
              [ClaimsServiceSchemaorg.category]: SECTOR,
              [ClaimsServiceSchemaorg.identifier]: 'did:web:provider.example.com',
              [ClaimsServiceSchemaorg.serviceType]: testDefaultTenantServiceTypeClaim,
              [ClaimsServiceSchemaorg.termsOfService]: 'https://example.com/terms',
            },
            [{
              id: 'signed-individual-form',
              media_type: 'application/pdf',
              data: { links: ['https://www.dropbox.com/scl/fi/example/signed-individual-form.pdf?dl=1'] },
            }],
          ));
          const body = response.body as BundleJsonApi;
          const entry = body.data[0] as BundleEntry;

          expect(fetchSpy).toHaveBeenCalledWith(
            'https://www.dropbox.com/scl/fi/example/signed-individual-form.pdf?dl=1',
            { redirect: 'follow' },
          );
          expect(entry.meta?.claims).toEqual(expect.objectContaining({
            'org.schema.FamilyRegistration.status': 'new_created',
            [ClaimsOrganizationSchemaorg.alternateName]: fixture.expectedOrganizationAlternateName,
            [ClaimsOrganizationSchemaorg.ownerEmail]: fixture.expectedControllerEmail,
            [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_SERIALNUMBER || '').trim(),
            [ClaimsPersonSchemaorg.identifierValue]: String(process.env.TEST_INDIVIDUAL_CONTROLLER_CERT_SERIALNUMBER || '').trim(),
          }));
        } finally {
          fetchSpy.mockRestore();
        }
      });
  });

  // -------------------------------------------------------------------------
  // _search — processFamilySearchEntry
  // -------------------------------------------------------------------------

  describe('_search / processFamilySearchEntry', () => {
    it('not_found: returns not_found when no doc matches owner + alternateName', async () => {
      mockVaultRepository.query.mockResolvedValue([]);

      const response = await manager.process(makeSearchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('not_found');
    });

    it('already_exists: returns already_exists from _search when Active record is found', async () => {
      const existingContent = {
        status: EntityLifecycleStatus.Active,
        claims: {
          [ClaimsOrganizationSchemaorg.ownerTelephone]: '+34600000001',
          [ClaimsOrganizationSchemaorg.alternateName]: 'Ana',
        },
        contained: [],
      };
      mockVaultRepository.query.mockResolvedValue([{ id: 'active-search-id', jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);

      const response = await manager.process(makeSearchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('already_exists');
    });

    it('resume_required: returns resume_required from _search when Pending record is found', async () => {
      const existingContent = {
        status: EntityLifecycleStatus.Pending,
        claims: {
          [ClaimsOrganizationSchemaorg.ownerTelephone]: '+34600000001',
          [ClaimsOrganizationSchemaorg.alternateName]: 'Ana',
        },
        contained: [],
      };
      mockVaultRepository.query.mockResolvedValue([{ id: 'pending-search-id', jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);

      const response = await manager.process(makeSearchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('resume_required');
    });
  });

  describe('_purge / processFamilyPurgeEntry', () => {
    it('disabled: marks the family registration inactive without touching licenses', async () => {
      const existingContent = {
        status: EntityLifecycleStatus.Active,
        claims: { ...BASE_CLAIMS },
        contained: [],
      };
      mockVaultRepository.query.mockResolvedValue([{ id: 'family-doc-1', status: 'active', sequence: 1, jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await manager.process(makeDisableJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('disabled');
      expect(entry.response?.status).toBe('200');
      const updatedDocs = mockVaultRepository.put.mock.calls[0][1] as ConfidentialStorageDoc[];
      expect(updatedDocs[0].status).toBe(EntityLifecycleStatus.Inactive);
    });

    it('purged: keeps the family record and releases associated licenses only after disable', async () => {
      const existingContent = {
        status: EntityLifecycleStatus.Inactive,
        claims: {
          ...BASE_CLAIMS,
          'org.schema.IndividualProduct.serialNumber': 'lic-123',
        },
        contained: [],
      };
      const licenseDoc: ConfidentialStorageDoc = {
        id: 'license-1',
        status: 'issued',
        sequence: 2,
        content: {
          id: 'license-1',
          userClass: 'individual',
          status: 'issued',
          activationCode: 'lic-123',
          issuedToEmail: 'child@example.com',
        } as any,
      };

      mockVaultRepository.query.mockResolvedValue([{ id: 'family-doc-1', status: 'inactive', sequence: 1, jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);
      mockVaultRepository.getContainersInSection.mockResolvedValue([licenseDoc]);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await manager.process(makePurgeJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('purged');
      expect(entry.response?.status).toBe('200');
      expect(mockVaultRepository.put).toHaveBeenCalledTimes(2);
      const updatedLicenseDocs = mockVaultRepository.put.mock.calls[0][1] as ConfidentialStorageDoc[];
      expect(updatedLicenseDocs[0].status).toBe('available');
      expect((updatedLicenseDocs[0].content as any).activationCode).toBeUndefined();
      const updatedFamilyDocs = mockVaultRepository.put.mock.calls[1][1] as ConfidentialStorageDoc[];
      expect(updatedFamilyDocs[0].status).toBe(EntityLifecycleStatus.Inactive);
    });

    it('returns 409 when family registration is still active during purge', async () => {
      const existingContent = {
        status: EntityLifecycleStatus.Active,
        claims: { ...BASE_CLAIMS },
        contained: [],
      };
      mockVaultRepository.query.mockResolvedValue([{ id: 'family-doc-1', status: 'active', sequence: 1, jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);

      const response = await manager.process(makePurgeJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.response?.status).toBe('409');
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });
  });
});
