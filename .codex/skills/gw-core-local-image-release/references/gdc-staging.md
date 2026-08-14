# GW CORE staging target

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
