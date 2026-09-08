---
name: preserve-subject-section-provenance
description: Preserve author, attester, subject and sender boundaries for subject-section writes and later FHIR document projection. Use for Composition-compatible flat claims, updateSubjectSection or updateClinicalSection, individual member/controller RelatedPerson attesters, professional PractitionerRole attesters, actorIdentifier confusion, section create/update/delete examples, confidential indexing, or a future Provenance.agent role migration.
---

# Preserve Subject Section Provenance

## Keep the Current Model

Preserve Composition-compatible flat claims on every section batch or
collection. Confidential storage indexes those claims per resource so the
section can later be materialized as a `Bundle.type=document` containing a
`Composition`.

Do not replace the current claims with `Provenance` until CORE implements and
migrates the corresponding indexed search claims.

Keep these values independent:

- `subject`: human or animal whose information is updated.
- `dataAuthorReference`: FHIR author/source of this specific write.
- `attester`: FHIR assignment bound to the authenticated, unlocked profile.
- `sender`: operational DID transporting the request.
- `section`: functional section, clinical or non-clinical.

Allow `dataAuthorReference` to change on every write while the same unlocked
profile keeps the same `attester`. Never treat `actorIdentifier` as an alias
for either value; it belongs to authorization and Consent identity.

Use `updateSubjectSection(...)` in new application examples. Retain
`updateClinicalSection(...)` only as a compatibility alias unless a separate
breaking migration is explicitly authorized.

## Resolve the Attester from Real Data

For an individual member, controller or caregiver:

1. Read the actual response from the existing `RelatedPerson/_search`
   contact/member flow.
2. Select the intended active row server-side by verified data.
3. Use its governed `RelatedPerson.identifier` UUID.
4. Canonicalize it as `urn:uuid:<uuid>` with the shared SDK helper.

Registration of an individual organization does not create a
`RelatedPerson`. Never substitute the individual resource id, subject DID,
actor DID, profile id, email, telephone or OAuth client id.

For a professional:

1. Read the actual Employee creation receipt.
2. Select its contained `PractitionerRole`.
3. Use the returned `PractitionerRole.id` UUID.
4. Canonicalize it as `urn:uuid:<uuid>` with the shared SDK helper.

A personal profile has no `PractitionerRole`; never manufacture one.

Treat `enroll()` as technical profile/wallet/DCR setup. It may protect the
stable profile attester so it is returned after unlock, but it must not choose
or freeze the author of later section writes.

## Resolve the Data Author

Preserve an imported `Composition.author` exactly.

For locally provider-authored data, build the legal-organization author with
`buildOrganizationAuthorizationUrnCds(...)` from the real jurisdiction and
legal identifier.

For personally authored data, use the real stable FHIR reference of the person
or assignment that authored that write. Use the profile RelatedPerson
reference as author only when that RelatedPerson truly authored the data.

Never copy a sample URN or infer the author from the attester or sender.

## Keep Examples Copyable

For every snippet:

- include every import;
- show where every value comes from;
- accept application-owned values as typed inputs;
- obtain SDK-owned values from shown SDK calls;
- use shared builders and fixtures instead of literals;
- include create, update with `ifMatch`, and delete with `ifMatch` and no
  resource body when documenting section mutations;
- show both individual member/controller and professional paths when the guide
  claims to cover both.

Use these canonical sources:

- Node SDK end-to-end:
  `docs/101-SDK_END_TO_END.md`
- Type-checked application snippet:
  `docs/snippets/subject-section-writes.ts`
- Concise SDK explanation:
  `docs/101-CLINICAL_AUTHOR_ATTESTER_BOUNDARIES.md`
- CORE storage/index explanation:
  `docs/01-OVERVIEW-AND-GUIDES/101-01.N-AUTHENTICATED-CLINICAL-AUTHOR.md`

Link to the canonical SDK snippet from CORE. Do not maintain a second,
divergent copy.

## Reserve Future Provenance Work

Treat `Provenance.agent-<code>` search claims, including enterer, performer
and author roles, as a future internal migration. Before exposing them:

1. define canonical shared claim names and participation codes;
2. add claims-first CORE indexing and search behavior;
3. migrate existing Composition-compatible indexed data;
4. preserve document projection and signature verification behavior;
5. update SDK APIs and examples only after the backend path is executable.

Do not mix Smart Health Card, detached-signature, ES384 or PQC work into a
simple section-write change unless explicitly requested.

## Use Precise Wording

In developer-facing explanations, avoid using "contract" as a generic heading
or synonym for the current model. Prefer "current rules", "current model",
"field separation" or "storage/index behavior".

Use "Contract" when referring to the FHIR `Contract` resource, "smart
contract" for ledger code, or "API/schema contract" only when a formal
interface guarantee is actually meant.

