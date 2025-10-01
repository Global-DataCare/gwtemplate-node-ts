// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/employee-config.ts

import { DidDocument } from './did';
import { RecordBase } from './resource-document';

/**
 * Represents the master configuration document for an employee within a tenant's vault.
 * This is the analogue to the TenantConfig for organizations.
 */
export interface EmployeeConfig extends RecordBase {
  /** The current status of the employee's account. */
  status: 'active' | 'disabled';

  /** The primary contact email for the employee. */
  email: string;

  /** The decentralized identity document for the employee, containing keys and service endpoints. */
  didDocument: DidDocument;
}
