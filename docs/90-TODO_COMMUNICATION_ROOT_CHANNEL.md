# TODO: Root Communication Channel (Smart Token Bootstrap)

Date: 2026-05-20
Status: Prepared for implementation

## Goal
Establish a root communication channel per subject (`individual` or `organization`) at first useful smart-access-token issuance, and link all subsequent `Communication` / `CommMsgExtended` messages and documents to that channel.

## Canonical threading model
1. DIDComm thread fields remain canonical:
   1. `thid`
   2. `pthid`
2. Add channel linkage fields:
   1. `channelId` (UUID of root channel per subject)
   2. `part-of` (root channel id or message id inside the same channel)

## Ingestion policy
1. Canonical write path:
   1. `Communication/_batch`
   2. `CommMsgExtended` compatibility path
2. Communication payload is treated as document-centric:
   1. accept `FHIR Bundle` with `type=document`
   2. reject `type=collection` and `type=message` for projection (future extension)
3. Persist communication trace and projected artifacts linked to:
   1. `thid/pthid`
   2. `channelId`
   3. `part-of`

## Root channel creation rule
1. Trigger point:
   1. first smart token issuance for subject update scope
2. Behavior:
   1. if channel exists, reuse it
   2. if channel does not exist, create new UUID channel and persist it
3. Apply same pattern to:
   1. individual controller/member
   2. organization controller (where applicable)

## Index and search requirements
1. Bundle/documental search must support filters by:
   1. `channelId`
   2. `part-of`
   3. `thid/pthid`
   4. existing indexed claims (section, date, code, category, author, included types)

## Out of scope now
1. Task derivation and workflow behavior changes
2. FHIR `Bundle.type=message` ingestion (future TODO)

## TDD bootstrap added
1. Contract type scaffold:
   1. `src/types/connection-channel.ts`
2. Test blueprint (non-wired implementation tasks):
   1. `src/__tests__/unit/managers/ConnectionChannel.tdd.test.ts`
