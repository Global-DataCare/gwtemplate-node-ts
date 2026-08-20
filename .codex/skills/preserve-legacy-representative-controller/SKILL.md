---
name: preserve-legacy-representative-controller
description: Preserve or audit a scoped historical legal-representative first controller during legacy tenant creation, while keeping later ServiceControllerCredential onboarding independent. Use for legacy _activate, _transaction plus Order, tenant DID controller arrays, activation-code or DCR failures, or independent enrollment-channel separation where personal data must not enter technical artifacts.
---

# Preserve a scoped legacy representative controller

## Read first

Read repository `AGENTS.md` and
`docs/03-IDENTITY-AND-TRUST/03.K-LEGACY-REPRESENTATIVE-CONTROLLER-COMPATIBILITY.md`.
Inspect the live tenant DID and controller DID endpoints before changing code or
claiming that a binding exists.

## Keep the identity boundaries explicit

- Treat the historical `LegalRepresentativeCredential` as legal evidence, not
  global `RESPRSN` authority.
- For historical `_activate` credentials without `RESPRSN` or embedded key
  material, require the exact tenant/sector scope in
  `HOST_LEGACY_CONTROLLER_SCOPES`.
- Never pin a credential id, issuer or `kid` in this compatibility switch. The
  normal VP, credential and trust-registry checks authenticate the submission;
  this permits credential renewal and controller-key rotation.
- Preserve modern `ServiceControllerCredential` validation unchanged.
- Append controller DIDs; never replace another active controller implicitly.
- Build the bootstrap controller before tenant finalization and put its DID in
  the organization DID from the first active version.
- Treat the same exact `_activate` or `_transaction` submission for an existing
  tenant as an idempotent re-registration: upsert the controller, append its DID
  and recreate a missing tenant collection without creating another Offer.
- Keep later service-controller `_issue`, activation code, `Token/_exchange`
  and `Device/_dcr` as distinct steps.

## Protect personal data

Never add a clear email, portal username, full name or contact-derived hash to
source, tests, documentation, comments, logs, skill files or checked-in
deployment configuration. Use neutral actor labels such as
`historical representative` in technical artifacts.

The scope configuration may contain only tenant and sector identifiers. Runtime
contact claims remain confidential tenant data and must not be projected into
public policy.

## Implementation workflow

1. Add the failing activation and Order finalization tests first.
2. Ensure `process-organization-activation.ts` passes the generated controller
   DID into tenant finalization.
3. Ensure `process-order-entry.ts` builds the pending representative controller
   before finalizing the tenant and passes its DID into tenant finalization.
4. Keep the historical activation exception fail-closed when its tenant/sector
   deployment scope is absent, malformed or mismatched.
5. Do not add legacy representative handling to existing-tenant `_issue`.
6. Update route JSDoc, generated OpenAPI, identity/trust docs and changelog.
7. Run targeted unit and integration tests, typecheck, skill validation and a
   changed-file scan for personal data.
8. Keep the reusable lifecycle behavior in GW Core and configure deployment
   scopes only in the environment that still needs the historical contract.

## Required verification

- Scoped legacy activation succeeds and creates the first controller reference
  even when the historical credential lacks `RESPRSN`.
- `_transaction` plus Order finalization creates the same reference.
- Existing-tenant `_activate` and `_transaction` re-registration return success
  with one unchanged controller reference and no new Offer.
- The public `tenant-status.json` projection moves from `required` to
  `credential_issued` and then `dcr_active` without exposing contact data.
- A tenant or sector outside the configured scope fails before activation;
  credential and signer failures remain governed by normal trust validation.
- Canonical service-controller tests remain green.
- Generated OpenAPI keeps legacy creation separate from service-controller
  `_issue`.
- No final report claims employee lifecycle is ready until the tenant route,
  organization controller reference and controller public key all resolve.
