# 04 Claims and FHIR Rules

This file follows the shared narrative contract in
[01-narrative-contract.md](./01-narrative-contract.md).

Claims model:

- Claims map to interoperable ids such as `Resource.param-name`.
- `resource.meta.claims` is the canonical business contract in this stack.
- `resource.meta.claims` is not base FHIR. It is a project-specific claims container carried by a FHIR-shaped resource.

Context rule:

- Prefer contextualized claims through `@context`.
- Typical contexts are `org.schema` and `org.hl7.fhir.api`.
- Do not repeat a fully-qualified prefix when the active `@context` already makes the meaning unambiguous.

Compatibility rule:

- Keep aliases only as temporary compatibility and mark them TODO.
- Do not teach compatibility aliases as if they were the canonical contract.

Developer rule:

- Reuse shared claim constants and shared fixtures in tests and examples.
- Do not hardcode claim keys in new 101 material unless the example is explicitly teaching the raw wire format.

FHIR-shape rule:

- Use the FHIR field when the meaning belongs naturally in FHIR.
- Use `resource.meta.claims` when the project needs a canonical interoperable claim not modeled cleanly by base FHIR fields alone.

For medication capture:

- human capture text in `MedicationStatement.note`
- medication artifact text in `MedicationStatement.medication-text`

Read next:

- [Communication layering 101](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)
- [Resource claims 101](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-RESOURCE_CLAIMS.md)
