# Public deliverables

[Spanish version](./README.md)

This directory contains the public, reusable documents for demonstrating and
transferring a host deployment. It contains no participant names, domains, IP
addresses, credentials or inventories from a specific deployment.

- `EVIDENCE_REPRODUCIBLE_LOCAL_EN.md`: local audit proof; it is not a migration
  or an external deployment.
- `MIGRATION_AND_DEPLOYMENT_ICA_EN.md`: operational procedure for migrating or
  promoting the data-space ICA to PostgreSQL and IPFS.
- `PROCEDURE_HOST_ONBOARDING_EN.md`: short sequential procedure for onboarding a
  host in `test-network` and then in production.
- `REFERENCE_OPERATIONAL_SUMMARY_EN.md`: operational summary and public references
  for transfer to the responsible team.
- `GUIDE_REPRODUCIBLE_HOST_EN.docx`: public Word document for project reporting
  and consulting.
- `GUIDE_REPRODUCIBLE_HOST_EN.html`: editable source of the Word document.
- `GUIDE_HOST_OPERATIONS_EN.md`: command-oriented procedure organized by role for
  `local-network`, `test-network` and production.
- `EVIDENCE_REPRODUCIBLE_HOST_EN.md`: scope, execution and verifiable limits
  of the software deliverable.

The deployment-specific annex is kept outside the public repository. It must
pin the commit and checksums of this delivery.

Operational order:

```text
MIGRATION_AND_DEPLOYMENT_ICA_EN.md
                  ↓
PROCEDURE_HOST_ONBOARDING_EN.md (test-network)
                  ↓
PROCEDURE_HOST_ONBOARDING_EN.md (network, with new identities)
```

The local deliverable is executed separately to demonstrate that the same
tools are reproducible. It does not claim that a particular external
infrastructure has already been migrated or deployed.

## Public Helm chart

The same chart validated in `local-network` is distributed through OCI:

```bash
helm pull oci://ghcr.io/global-datacare/gdc-host --version 0.4.0
helm show chart oci://ghcr.io/global-datacare/gdc-host --version 0.4.0
```

Package: [gdc-host on GHCR](https://github.com/orgs/Global-DataCare/packages/container/package/gdc-host).
Published OCI manifest digest:
`sha256:1382c6d302dea258ee1c625e300e60c6a0b63959b3adef72da7d92a46e397784`.

The Node Operator DevOps team may use the OCI artifact or the
`charts/gdc-host` directory from the delivered commit. `values`, Secrets, VC,
enrollment grants, MSP/TLS material and endpoints are specific to each
environment and remain outside the repository. CCAAS package IDs are
deterministic and shared by hosts using the standard Services.

## Verified public OCI images

- [GW CORE](https://github.com/orgs/Global-DataCare/packages/container/package/gw-core):
  `ghcr.io/global-datacare/gw-core@sha256:a9d18e92fc422f4fd79d18bfce6977814812187870f6ddda72aebc8428ae5b18`
- [CCAAS runtime](https://github.com/orgs/Global-DataCare/packages/container/package/host-runtime):
  `ghcr.io/global-datacare/host-runtime@sha256:f5d45cebaa5e7443ebf70aac85f33794d3d366dcb5370ab7921e9bc56336c0fa`

GW CORE and CCAAS are independent artifacts. The latter contains the ten
chaincode servers and uses the stable `gdc-cc-<contract>:9999` Services,
isolated by each host namespace.
