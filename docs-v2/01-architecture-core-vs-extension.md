# 01 Architecture: Core vs Extension

Core scope:

- canonical transport and payload contracts,
- canonical resource shapes such as `Communication`, `Composition`, `DocumentReference`, `Consent`,
- validation and routing baseline,
- async submit/poll contract,
- interoperability rules that must stay stable across sectors.

Extension scope:

- operational domain logic,
- sector-specific flows,
- compatibility helpers,
- optional adapters that must remain subordinate to the core contract.

Rule:

- extension must not break core contracts,
- extension must not redefine the meaning of shared claims,
- extension may simplify a flow, but it must not teach a different wire model than CORE.

## Why the split exists

This split protects three things:

1. Stable contracts for SDKs and external integrators.
2. Cross-sector reuse for `health-*`, `animal-*`, and `onehealth-*`.
3. Clear separation between interoperable semantics and local deployment decisions.

Without that split, examples drift, claims drift, and different sectors start teaching different payload models for the same operation.

## Canonical source-of-truth docs

- [Communication layering 101](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)
- [SDK package boundaries](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-SDK_PACKAGE_BOUNDARIES.md)
- [GW core integration baseline](../docs/API_CORE_INTEGRATION.md)
