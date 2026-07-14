# 101 Reading Path

> 101 note
> - Start here when you need the current GW reading order.
> - In `gwtemplate-node-ts`, the current canonical onboarding path is `docs-v2` for active integrator/runtime guidance and `docs-end` for closeout/audit packaging.
> - Do not treat legacy `docs/01-*` 101 notes as the primary current entrypoint.

## User Story Start

For a self-managed user in a BFF, web app, or native app, the canonical story
starts upstream:

1. authenticate the user
2. load/unlock one protected profile
3. materialize one loaded workspace/session and actor-scoped runtime facade
4. assume or bootstrap the actor state already owned by that user
5. only then submit/poll GW routes to create/read/edit/search business data

Current upstream entrypoints:

- backend/BFF runtime:
  [gdc-sdk-node-ts/tests/101-backend-profile-runtime.test.mjs](https://github.com/Global-DataCare/gdc-sdk-node-ts/blob/main/tests/101-backend-profile-runtime.test.mjs)
- backend profile workspace:
  [gdc-sdk-node-ts/tests/101-profile-workspace-runtime.test.mjs](https://github.com/Global-DataCare/gdc-sdk-node-ts/blob/main/tests/101-profile-workspace-runtime.test.mjs)
- frontend/native runtime:
  [gdc-sdk-front-ts/tests/101-frontend-profile-runtime.test.mjs](https://github.com/Global-DataCare/gdc-sdk-front-ts/blob/main/tests/101-frontend-profile-runtime.test.mjs)
- frontend individual-controller runtime:
  [gdc-sdk-front-ts/tests/101-individual-controller-frontend-runtime.test.mjs](https://github.com/Global-DataCare/gdc-sdk-front-ts/blob/main/tests/101-individual-controller-frontend-runtime.test.mjs)

Terminology rule:

- `ProfileRuntime`
  means the unlocked end-user profile runtime
- `TenantServiceRuntime`
  means the technical wallet/runtime owned by the service, tenant, or BFF for
  signing, encryption, DIDComm/plain wrapping, and confidential storage tasks
- `ChannelBackendPort`
  means a product/channel API above those runtimes, not a replacement for them

Responsibility split for newbies:

- the sender-side user profile runtime or BFF/channel outbox decides what is
  sent first and how replies are decoded locally
- the client-facing read path is:
  decode one DIDComm/plain payload -> read one `Communication` -> open its
  attached payload
- for current health document cases, that attached payload should normally be
  one document bundle with `Composition` first entry
- backend search semantics are separate and must be documented with public
  FHIR search params such as `Composition.section`
- GW does not replace that local queue/runtime
- GW owns endpoint acceptance and server-side async processing only after
  reception

Canonical upstream snippet references:

- author one current health payload:
  [gdc-common-utils-ts/__tests__/101-communication-medication-document.test.ts](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/__tests__/101-communication-medication-document.test.ts)
- render/read one transport payload:
  [gdc-common-utils-ts/__tests__/101-communication-profile-wallet-e2e.test.ts](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/__tests__/101-communication-profile-wallet-e2e.test.ts)
- load one unlocked backend profile and submit/poll:
  [gdc-sdk-node-ts/tests/101-backend-profile-runtime.test.mjs](https://github.com/Global-DataCare/gdc-sdk-node-ts/blob/main/tests/101-backend-profile-runtime.test.mjs)

## Read First

1. [gdc-common-utils-ts/docs/101-BFF_AND_CHANNEL_MESSAGE_FLOW.md](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-BFF_AND_CHANNEL_MESSAGE_FLOW.md)
2. [gdc-common-utils-ts/docs/101-COMMUNICATION_LAYERING.md](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)
3. [00-quickstart.md](./00-quickstart.md)
4. [09-api-integrators-guide.md](./09-api-integrators-guide.md)
5. [18-organization-controller-lifecycle.md](./18-organization-controller-lifecycle.md)
6. [../docs-end/README.md](../docs-end/README.md)

## Boundary

- Teach here: current GW route/contract/lifecycle semantics after profile/runtime login already happened upstream.
- Reuse shared helper and SDK references instead of rebuilding login/profile stories in GW docs.
- Use `docs-end` for packaged closeout/audit narrative, not for replacing current integrator/runtime guidance.
