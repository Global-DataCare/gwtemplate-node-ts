---
name: preserve-legacy-representative-controller
description: Preserve or audit a deployment-authorized historical legal-representative first controller during legacy tenant creation, while keeping later ServiceControllerCredential onboarding independent. Use for legacy _activate, _transaction plus Order, tenant DID controller arrays, activation-code or DCR failures, or independent enrollment-channel separation where personal data must not enter technical artifacts.
---

# Preserve a legacy representative controller

## Read first

Read repository `AGENTS.md` and
`docs/03-IDENTITY-AND-TRUST/03.K-LEGACY-REPRESENTATIVE-CONTROLLER-COMPATIBILITY.md`.
Inspect the live tenant DID and controller DID endpoints before changing code or
claiming that a binding exists.

## Keep the identity boundaries explicit

- Treat the historical `LegalRepresentativeCredential` as legal evidence, not
  global `RESPRSN` authority.
- In legacy portal registration, bind the submitted JWK only to the legal
  representative who performs that registration. A different controller named
  by signed evidence is a pending designation, not the owner of that JWK.
- Do not require or synthesize a technical-controller JWK during legacy tenant
  creation. That actor later supplies its own key through sector `_issue`,
  activation, token exchange and DCR.
- For historical `_activate` credentials without `RESPRSN` or embedded key
  material, require deployment-wide
  `HOST_LEGACY_REPRESENTATIVE_CONTROLLER=true` compatibility.
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
- Treat tenant key provisioning as idempotent too. After restart, recover and
  return the persisted signing, encryption, storage and HMAC keys; never use an
  activation or Order replay as implicit key rotation.
- Before serving tenant traffic, reconcile a stale public tenant DID only from
  the public counterparts of recoverable KMS keys. Preserve the DID id, aliases,
  controllers and services, and re-sign an obsolete tenant self-description.
- Keep later service-controller `_issue`, activation code, `Token/_exchange`
  and `Device/_dcr` as distinct steps.
- When DCR changes an employee DID document, rebuild the protected `kid`
  indexes from every currently active verification method. For records written
  before this rule, an indexed miss may scan only the resolved tenant scopes
  and authenticate only an exact `iss` plus signing `kid` plus encryption
  `skid` match; an envelope-supplied JWK is never authority.
- In canonical `Token/_exchange`, use the validated request-route tenant.
  Firebase proves actor/contact identity and does not need a custom
  `tenant_id`; when present, that claim must match and must never reroute the
  exchange. Preserve a failed poll `OperationOutcome` before checking for
  `initial_access_token`.
- When an accepted organization Order is replayed before `Token/_exchange`,
  recover and return the representative seat's existing activation code. Do
  not rotate the code, consume another seat or return a successful response
  that omits the continuation material.

## Preserve employee-seat and device boundaries

- New professional organizations reserve their first two seats for the
  verified representative and a contact-free technical-controller binding.
  Promotions above two leave only the excess seats available.
- Never apply the second reservation retroactively. Preserve a historical
  professional second seat and require a newly added or purchased licence
  before another controller can bind; never create an implicit third seat.
- Startup repair may add only a missing mandatory representative seat from
  protected verified tenant claims and may restore only controller DIDs backed
  by active protected employee records.
- Permit zero-price professional `License/_add` only in non-production `test`
  (in-memory ledger), `local-network`, or `test-network`. `prod` or `network`
  uses signed payment confirmation and the Order lifecycle.
- Employee creation persists the employee only. The following explicit
  licence-issue operation reserves the seat and returns the activation
  credential; never consume the same seat in both operations.
- Employee records use the resolved physical tenant collection while
  device-licence records remain in the logical tenant vault.
- One actor seat supports five active channel/device bindings by default.
  Revoking one binding requires explicit portal confirmation and never releases
  the employee seat; only purging an already suspended employee releases it.

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
4. Keep the historical activation exception fail-closed when deployment
   compatibility is disabled or malformed.
5. Do not add legacy representative handling to existing-tenant `_issue`.
6. Update route JSDoc, generated OpenAPI, identity/trust docs and changelog.
7. Run targeted unit and integration tests, typecheck, skill validation and a
   changed-file scan for personal data.
8. Verify the live pod environment contains the switch after rollout; a local
   profile or documentation entry alone does not activate the policy.
9. Keep the reusable lifecycle behavior in GW Core and enable it only in an
   environment whose portal still uses the historical contract for all
   organizations.

## Required verification

- Scoped legacy activation succeeds and creates the first controller reference
  even when the historical credential lacks `RESPRSN`.
- `_transaction` plus Order finalization creates the same reference.
- Existing-tenant `_activate` and `_transaction` re-registration return success
  with one unchanged controller reference and no new Offer.
- The public `tenant-status.json` projection moves from `required` to
  `credential_issued` and then `dcr_active` without exposing contact data.
- A DCR-updated employee is queryable by each active signing/encryption `kid`,
  and a historical stale-index fixture still verifies only against keys found
  inside the protected employee DID document.
- A restart followed by activation/Order replay leaves the tenant encryption
  `kid` unchanged; a deliberately stale DID projection is repaired without
  generating keys or changing controllers and encrypted inventory is accepted.
- Re-verification that omits a previously signed technical-controller field
  preserves its hashed pending designation and never copies the representative
  JWK to that actor.
- A deployment with compatibility disabled rejects the historical shape;
  credential and signer failures remain governed by normal trust validation.
- Canonical service-controller tests remain green.
- Generated OpenAPI keeps legacy creation separate from service-controller
  `_issue`.
- No final report claims employee lifecycle is ready until the tenant route,
  organization controller reference and controller public key all resolve.
