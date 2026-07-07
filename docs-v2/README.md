# Docs V2 Index

Purpose:

- provide one reading index for the normalized `docs-v2` set,
- clarify which research/digital twin documents are complementary rather than
  duplicated,
- make numbering and intent explicit.

For 101 narration, use [01-narrative-contract.md](./01-narrative-contract.md)
as the repository-local version of the root
[NARRATIVE-ALIGNMENT.md](../NARRATIVE-ALIGNMENT.md) contract before reading
any individual flow file.

## Reading order

1. [00-quickstart.md](./00-quickstart.md)
2. [01-architecture-core-vs-extension.md](./01-architecture-core-vs-extension.md)
3. [02-api-contracts.md](./02-api-contracts.md)
4. [03-run-e2e.md](./03-run-e2e.md)
5. [04-claims-and-fhir-rules.md](./04-claims-and-fhir-rules.md)
6. [05-use-case-flow-explanations.md](./05-use-case-flow-explanations.md)
7. [06-security-model-and-why.md](./06-security-model-and-why.md)
8. [07-didweb-pqc-and-trust-chain.md](./07-didweb-pqc-and-trust-chain.md)
9. [08-release-playbook.md](./08-release-playbook.md)
10. [09-api-integrators-guide.md](./09-api-integrators-guide.md)
11. [10-host-organization-activate.md](./10-host-organization-activate.md)
12. [11-individual-index-bootstrap.md](./11-individual-index-bootstrap.md)
13. [12-communication-batch-index-data.md](./12-communication-batch-index-data.md)
14. [13-subject-summary-operation.md](./13-subject-summary-operation.md)
15. [14-smart-token.md](./14-smart-token.md)
16. [15-related-person-index-data.md](./15-related-person-index-data.md)
17. [16-deactivation-and-purge-lifecycle.md](./16-deactivation-and-purge-lifecycle.md)
18. [17-clinical-bundle-readers.md](./17-clinical-bundle-readers.md)
19. [18-organization-controller-lifecycle.md](./18-organization-controller-lifecycle.md)
20. [19-key-custody-and-audit-readiness.md](./19-key-custody-and-audit-readiness.md)
21. [20-research-digital-twin-store-and-search-plan.md](./20-research-digital-twin-store-and-search-plan.md)
22. [21-research-digital-twin-technical-backlog.md](./21-research-digital-twin-technical-backlog.md)
23. [22-environment-variables-reference.md](./22-environment-variables-reference.md)
24. [23-digital-twin-composition-search-contract.md](./23-digital-twin-composition-search-contract.md)
25. [24-local-audit-fabric-runtime.md](./24-local-audit-fabric-runtime.md)
26. [25-trust-bundle-and-local-network-runbook.md](./25-trust-bundle-and-local-network-runbook.md)
27. [99-migration-map-from-docs.md](./99-migration-map-from-docs.md)

## Research / Digital Twin Map

These documents are related but not duplicates:

- [20-research-digital-twin-store-and-search-plan.md](./20-research-digital-twin-store-and-search-plan.md)
  - broad architecture and rollout plan for the separate research/digital-twin
    store
- [21-research-digital-twin-technical-backlog.md](./21-research-digital-twin-technical-backlog.md)
  - code-oriented backlog and implementation slicing for that plan
- [23-digital-twin-composition-search-contract.md](./23-digital-twin-composition-search-contract.md)
  - concrete public contract for the currently implemented
    `digitaltwin/.../Composition/_search` route

Practical rule:

- `20` = architecture plan
- `21` = implementation backlog
- `23` = current public route contract

So the numbering is fine as-is; the files cover different layers.

