// src/__tests__/end-to-end.test.ts
import express from 'express';
import supertest from 'supertest';
import { QueueAdapterMem } from '../adapters/queue-mem';
import { TenantMemManager } from '../managers/TenantMemManager';
import { EmployeeManager } from '../managers/EmployeeManager';
import { CustomerManager } from '../managers/CustomerManager';
import { GroupManager } from '../managers/GroupManager';
import { ListManager } from '../managers/ListManager';
import { createApiRouter } from '../routes/api';
import { createDiscoveryRouter } from '../routes/discovery';
import { getOrg1EmployeeBatch } from './org1.data'; // Ensure this data is updated
import { v4 as uuidv4 } from 'uuid';
import { ManagerRegistry } from '../managers/registry';

// Helper function to wait for async jobs
const waitForJob = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('End-to-End API Tests', () => {
  let app: express.Application;
  let request: supertest.SuperTest<supertest.Test>;
  let responseStore: Map<string, any>;
  let tenantManager: TenantMemManager;
  
  const org1AlternateName = 'org1';
  const tenantId = uuidv4();

  beforeAll(async () => {
    app = express();
    app.use(express.json());

    const db = DatabaseMem.getInstance();
    await db.createNewVault({ id: 'host' });

    responseStore = new Map<string, any>();
    tenantManager = new TenantMemManager(db);
    
    const managerRegistry: ManagerRegistry = {
      tenantManager: tenantManager,
      employeeManager: new EmployeeManager(db),
      customerManager: new CustomerManager(db),
      groupManager: new GroupManager(db),
      listManager: new ListManager(db),
    };

    const queueAdapter = new QueueAdapterMem(responseStore, managerRegistry);
    
    // Setup routers
    const apiRouter = createApiRouter(queueAdapter, tenantManager, responseStore);
    const discoveryRouter = createDiscoveryRouter(tenantManager);
    
    app.use('/api/', apiRouter);
    app.use('/', discoveryRouter);

    request = supertest(app);

    // Onboard the tenant needed for all other tests
    await tenantManager.set(tenantId, {
      legalName: 'ORG1', additionalType: 'Clinic', domain: 'clinic.example.com',
      identifier: 'taxID|CLINIC123', addressCountry: 'ES', email: 'admin@clinic.example.com',
    });
  });

  test('Should onboard employees in a batch via the async API', async () => {
    const employeeBatch = getOrg1EmployeeBatch('urn:tenant-urn'); // URN can be static for test
    const apiUrl = `/api/${org1AlternateName}/cds-es/v1/healthcare/employees/jsonapi/Employee/_batch`;

    // 1. Make the initial POST request
    const initialResponse = await request.post(apiUrl)
      .send(employeeBatch)
      .set('Content-Type', 'application/json')
      .expect(202);

    const { thid } = initialResponse.body;
    expect(thid).toBeDefined();

    // 2. Poll for the result
    const pollUrl = `/api/v1/${org1AlternateName}/cds-es/v1/healthcare/employees/jsonapi/Employee/_search`;
    let finalResponse;
    for (let i = 0; i < 10; i++) { // Poll up to 10 times
      await waitForJob(100); // Wait for the worker to process
      const pollRes = await request.post(pollUrl)
        .send(`thid=${thid}`)
        .set('Content-Type', 'application/x-www-form-urlencoded');

      if (pollRes.status === 200) {
        finalResponse = pollRes.body;
        break;
      }
    }

    // 3. Assert the final result
    expect(finalResponse).toBeDefined();
    expect(finalResponse.type).toBe('batch-response');
    expect(finalResponse.total).toBe(3);
    expect(finalResponse.data).toHaveLength(3);
    expect(finalResponse.data[0].response.status).toBe('201 Created');
  });

  // FUTURE: Add more tests for other managers and error cases.
});
