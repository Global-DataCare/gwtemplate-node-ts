// src/__tests__/org1-setup.test.ts
import { TenantMemManager } from '../managers/TenantMemManager';
import { EmployeeManager } from '../managers/EmployeeManager';
import { CustomerManager } from '../managers/CustomerManager';
import { GroupManager } from '../managers/GroupManager';
import { ListManager } from '../managers/ListManager';
import { getOrg1EmployeeBatch } from './org1.data';
import { v4 as uuidv4 } from 'uuid';

describe('Definitive End-to-End Onboarding Orchestration', () => {
  // --- Global Setup ---
  let db: DatabaseMem;
  let tenantManager: TenantMemManager;
  let employeeManager: EmployeeManager;
  let customerManager: CustomerManager;
  let groupManager: GroupManager;
  let listManager: ListManager;

  // --- Shared Data ---
  const org1AlternateName = 'org1';
  let org1TenantConfig: any;
  let org1TenantUrn: string;
  let customerVaultId: string;
  let customerUrn: string;
  beforeAll(async () => {
    db = DatabaseMem.getInstance();
    await db.createNewVault({ id: 'host' });

    tenantManager = new TenantMemManager(db);
    employeeManager = new EmployeeManager(db);
    customerManager = new CustomerManager(db);
    groupManager = new GroupManager(db);
    listManager = new ListManager(db);
  });

  // --- The Orchestration Flow ---

  test('Step 1: Onboard the Custodian Tenant (ORG1)', async () => {
    // This is the clean, simple input from the client.
      const orgData: SchemaorgOrganizationParam = {
        legalName: 'ORG1',
        additionalType: 'Clinic',
        domain: 'clinic.example.com',
        identifier: 'taxID|CLINIC123',
        addressCountry: 'ES',
        email: 'admin@clinic.example.com',
      };
    const tenantId = uuidv4();
    org1TenantConfig = await tenantManager.set(tenantId, orgData);

    expect(org1TenantConfig).toBeDefined();
    expect(org1TenantConfig.id).toBe(tenantId);
    expect(org1TenantConfig.alternateName).toBe(org1AlternateName);
    org1TenantUrn = TenantMemManager.getURN(org1TenantConfig);
    });

  test('Step 2: Batch-Onboard all initial Employees for ORG1', async () => {
    const employeeBatch = getOrg1EmployeeBatch(org1TenantUrn);
    const responseBundle = await employeeManager.processBatch(org1AlternateName, employeeBatch.entry);
    expect(responseBundle.total).toBe(3);
  });

  test('Step 3: Onboard a new Customer under ORG1s custodianship', async () => {
    const customerInput = {
      custodianTenantId: org1AlternateName,
        payload: {
        '@context': 'org.schema.Person' as const,
        '@type': 'Patient' as const,
        claims: { givenName: 'John', familyName: 'Smith' },
        },
      };
    const customerDoc = await customerManager.set(customerInput);
    expect(customerDoc.id).toEqual(customerDoc.vaultId);
    customerVaultId = customerDoc.vaultId;
    customerUrn = `urn:customer:${customerDoc.id}`;
    });

  test('Step 4: Build the Customer-centric Connection Channel', async () => {
    const familyGroupInput = {
      vaultId: customerVaultId,
        payload: {
          '@context': 'internal.json' as const,
        '@type': 'Group' as const,
        claims: { type: 'person', title: 'Smith Family' },
          },
      };
    const familyGroup = await groupManager.set(familyGroupInput);

    const profGroupInput = {
      vaultId: org1AlternateName,
      payload: {
        '@context': 'internal.json' as const,
        '@type': 'Group' as const,
        claims: { type: 'practitioner', title: 'Cardiology Department' },
      },
    };
    const profGroup = await groupManager.set(profGroupInput);

      const listInput = {
      vaultId: customerVaultId,
      payload: {
        '@context': 'internal.json' as const,
        '@type': 'List' as const,
        claims: { subject: customerUrn, source: org1TenantUrn },
      },
    };
    const list = await listManager.set(listInput);

    const profGroupRef = { reference: `Group/${profGroup.id}` };
    const familyGroupRef = { reference: `Group/${familyGroup.id}` };
    await listManager.addGroup(list.id, customerVaultId, profGroupRef);
    const finalList = await listManager.addGroup(list.id, customerVaultId, familyGroupRef);

      expect(finalList.entry.length).toBe(2);
    expect(finalList.vaultId).toBe(customerVaultId);
    expect(finalList.entry[0].item.reference).toContain(profGroup.id);
    expect(finalList.entry[1].item.reference).toContain(familyGroup.id);
    });
  });

