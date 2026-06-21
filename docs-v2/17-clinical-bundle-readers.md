# 17 Clinical Bundle Readers

Purpose:

- define the canonical high-level reader contract for IPS/clinical bundles,
- keep section-aware reading separate from legacy raw claim plumbing,
- make GW, SDK node, and assisted-channel apps use the same semantics.

## Canonical Rules

- section-aware readers must operate on one real clinical document with one `Composition`.
- resources must already carry one canonical section assignment.
- readers must not infer sections from resource type when the document omitted them.
- `sections?: readonly string[]` is the canonical selector shape.
- `sections === undefined` means all sections.
- `sections.length === 0` means all sections.

## Section Semantics

- use the IPS/core section codes owned by `gdc-common-utils-ts`.
- allergies belong to `LOINC|48765-2`.
- medication statements belong to `LOINC|10160-0`.
- conditions belong to one explicit problem section such as current/past problem lists.
- observations belong to the section declared by the document; vital signs are only the observations placed under the vital-sign section/category.

## Canonical Reader Surface

- `getSections()`
- `getSectionSummary({ sections? })`
- `getResources({ sections?, resourceType?, start?, end?, searchText?, count?, page?, offset? })`
- `getAllergies({ sections?, clinicalStatus?, verificationStatus?, criticality?, start?, end?, count?, page?, offset? })`
- `getConditions({ sections?, clinicalStatus?, verificationStatus?, severity?, start?, end?, count?, page?, offset? })`
- `getMedications({ sections?, status?, start?, end?, count?, page?, offset? })`
- `getVitalSigns({ sections?, code?, start?, end?, count?, page?, offset? })`
- `getLocalTextAndIntDisplay(resource)`
- `getXhtmlOrDerived(resource)`
- `getNarrative(resource)`

## Pagination Rules

- `count` limits page size.
- `page` is 1-based.
- `offset` is absolute and wins over `page` when both are present.
- pagination happens after section/date/text/family filters.

## Narrative Rules

- prefer stored `resource.text.div`.
- if XHTML is missing, derive it from canonical `meta.claims`.
- derived XHTML may include clinical date, period start/end, and family-specific fields such as `criticality`, `severity`, dosage, or vital-sign quantities.

## Source Of Truth

- shared fixture and sectioned claims example:
  [ips-bundle.ts](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/src/examples/ips-bundle.ts)
- shared readers/render helpers:
  [clinical-resource-view.ts](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/src/utils/clinical-resource-view.ts)
- SDK core document facade:
  [communication-document-facade.ts](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/src/communication-document-facade.ts)
- SDK node orchestration surface:
  [profile-workspace.ts](https://github.com/Global-DataCare/gdc-sdk-node-ts/blob/main/src/profile-workspace.ts)

## Related Tests

- `gdc-common-utils-ts/__tests__/101-ips-bundle-meta-claims.test.ts`
- `gdc-common-utils-ts/__tests__/utils-clinical-resource-view.test.ts`
- `gdc-sdk-core-ts/tests/101-communication-ips-document-reader.test.mjs`
- `gdc-sdk-node-ts/tests/101-profile-workspace-runtime.test.mjs`
- `gwtemplate-node-ts/src/__tests__/unit/examples/shared-bundle-entry-editors.test.ts`

## Out Of Scope

- inventing local section aliases outside `gdc-common-utils-ts`
- counting unsectioned resources as if they belonged to a section
- frontend/channel-specific formatting rules that are not shared across GW and SDK
