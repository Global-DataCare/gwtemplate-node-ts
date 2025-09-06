// src/utils/naming.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Creates a unique and informative name for a job to be placed in the queue.
 * The name follows the structure: <priority>-<timestamp>:<tenantId>:<resourceType>:<action>
 * 
 * Job Priority is based on a Triage scale, similar to the Manchester Triage System (MTS),
 * where 1 is the highest priority and 5 is the lowest. If not specified, priority defaults to 5.
 * 
 * @param tenantId The ID of the tenant context.
 * @param resourceType The type of the resource being processed.
 * @param action The action being performed (e.g., '_batch', '_update').
 * @param priority The priority of the job, from 1 (highest) to 5 (lowest).
 * @returns A unique, priority-sorted job name string.
 */
export function createJobName(tenantId: string, resourceType: string, action: string, priority: 1 | 2 | 3 | 4 | 5 = 5): string {
  const timestamp = Date.now();
  // Remove the leading underscore from the action for a cleaner name.
  const cleanAction = action.startsWith('_') ? action.substring(1) : action;
  return `${priority}-${timestamp}:${tenantId}:${resourceType}:${cleanAction}`;
}

/**
 * Parses a job name to extract its constituent parts.
 * 
 * @param jobName The unique job name.
 * @returns An object containing the parts of the name, or null if the name is invalid.
 */
export function parseJobName(jobName: string): { priority: number, timestamp: number, tenantId: string, resourceType: string, action: string } | null {
  const [priorityTime, tenantId, resourceType, action] = jobName.split(':');
  if (!priorityTime || !tenantId || !resourceType || !action) {
    return null;
  }
  const [priority, timestamp] = priorityTime.split('-').map(Number);

  if (isNaN(priority) || isNaN(timestamp)) {
    return null;
  }

  return {
    priority,
    timestamp,
    tenantId,
    resourceType,
    action: `_${action}` // Re-add the underscore for consistency with API actions
  };
}

/**
 * Creates a unique and informative identifier for a messaging section (e.g., an inbox or sent folder).
 * The name follows the structure: <timestamp>_<parentId>_<destinationId>_<type>
 * 
 * @param parentId The ID of the containing vault (e.g., a Group ID, a List ID).
 * @param destinationId The ID of the group or member the message is for/from.
 * @param type The type of the box (e.g., 'inbox', 'sent').
 * @returns A unique section ID string.
 */
export function createMessageSectionId(parentId: string, destinationId: string, type: 'inbox' | 'sent'): string {
  const timestamp = Date.now();
  return `${timestamp}_${parentId}_${destinationId}_${type}`;
}

