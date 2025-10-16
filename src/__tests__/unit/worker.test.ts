// src/__tests__/unit/worker.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import { mock, MockProxy } from 'jest-mock-extended';
import { Worker } from '../../worker';
import { IJobProcessor, ManagerRegistry } from '../../managers/registry';
import { JobRequest } from '../../models/request';
import { testCreateCustomerJobRequestProfessionalOnboarding } from '../data/customer-onboarding.data';
import { createJobName } from '../../utils/naming';

describe('Worker', () => {
  let worker: Worker;
  let mockManagerRegistry: MockProxy<ManagerRegistry>;
  let mockCustomerManager: MockProxy<IJobProcessor>;
  const API_BASE_URL = 'https://api.example.com';

  beforeEach(() => {
    mockCustomerManager = mock<IJobProcessor>();
    mockManagerRegistry = mock<ManagerRegistry>({
      customerManager: mockCustomerManager,
    });
    
    worker = new Worker(mockManagerRegistry, API_BASE_URL);
    jest.clearAllMocks();
  });

  it('should route a "Person" resourceType job to the CustomerManager', async () => {
    // ARRANGE
    const resourceType = 'Person';
    const jobName = createJobName(
      'health-care_acme',
      resourceType,
      '_batch',
    );
    
    const job: JobRequest = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'health-care_acme',
      resourceType: resourceType,
    };

    // ACT
    await worker.process(jobName, job);

    // ASSERT
    expect(mockCustomerManager.process).toHaveBeenCalledTimes(1);
    expect(mockCustomerManager.process).toHaveBeenCalledWith(job);
  });

  it('should throw an error for an unconfigured resourceType', async () => {
    // ARRANGE
    const resourceType = 'UnknownResource';
    const jobName = createJobName(
      'health-care_acme',
      resourceType,
      '_batch',
    );
    
    const job: JobRequest = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'health-care_acme',
      resourceType: resourceType,
    };

    // ACT
    const response = await worker.process(jobName, job);

    // ASSERT
    expect(mockCustomerManager.process).not.toHaveBeenCalled();
          const errorIssue = response.body.data[0].response.outcome.issue![0];
    expect(errorIssue.diagnostics).toContain(`No manager configured for resourceType '${resourceType}'`);
  });
});
