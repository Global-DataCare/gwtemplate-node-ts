# GW CORE staging target

## Product identity (do not infer from infrastructure names)

This target is **GW CORE**, not GW UNID and not GW SOSCHAIN:

| Product | Canonical workload identity |
|---|---|
| GW CORE | `34.175.78.233`, namespace `test-gdc-v1`, Deployment/Service `gwtemplate` |
| GW UNID | separate `uhc-gw` workload/domain |
| GW SOSCHAIN | separate `soschain-gw` workload/domain |

The CORE cluster retains the historical name `gdc-unid-southwest`. That name
is infrastructure history only and must never be used to label the product.
Do not use this reference or its deployment commands for `uhc-gw` or
`soschain-gw`.

Verify these values live before every mutation:

- GCP project: `globaldatacare-test`
- region: `europe-southwest1`
- cluster: `gdc-unid-southwest`
- namespace: `test-gdc-v1`
- Deployment and Service: `gwtemplate`
- Artifact Registry image:
  `europe-southwest1-docker.pkg.dev/globaldatacare-test/globaldatacare/globaldatacare-test`
- reserved public address resource: `gdc-gw-demo-ip`
- current public address: `34.175.78.233`

Primary profiles are `.env.gke.gdc` and `demo-deploy.config`. The current demo
uses `NETWORK_MODE=test`; local image validation uses `local-network`, while a
future production profile must use `network`. Inspect the live ConfigMap and
Deployment instead of assuming remembered values remain current.

Before reading or mutating Kubernetes state, select credentials explicitly for
`globaldatacare-test / europe-southwest1 / gdc-unid-southwest`, then verify the
current context contains that project and cluster. Abort if the resolved
workload is not `test-gdc-v1/gwtemplate` or the Service does not map to reserved
address `34.175.78.233`.
