// src/models/schemaorg/claims-action.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Defines the flat claim structure for a schema.org/Action.
 * This is used for requests where an entity (agent) performs an action,
 * often with a human controller (participant) initiating it.
 */
export enum ClaimsActionSchemaorg {
  // The primary agent performing the action (e.g., the Tenant Organization)
  agentIdentifier = 'org.schema.Action.agent.identifier',
  agentLegalName = 'org.schema.Action.agent.legalName',
  // ... other flattened properties of the agent ...

  // A co-agent participating in the action (e.g., the Human Controller T)
  participantIdentifier = 'org.schema.Action.participant.identifier',

  // The service provider or target of the action (e.g., the Fabric Network)
  providerIdentifier = 'org.schema.Action.provider.identifier',
  providerName = 'org.schema.Action.provider.name',

  // The time the action was initiated
  startTime = 'org.schema.Action.startTime',
}