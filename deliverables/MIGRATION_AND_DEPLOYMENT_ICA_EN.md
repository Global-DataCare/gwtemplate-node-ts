# Data-space ICA migration or promotion

This guide is for a real operation. It is not part of the local evidence of the deliverable, although it uses the same public migrator already tested.

## 1. Decision record

Before executing anything, the person responsible for the ICA environment leaves only one option in writing:

- **Transfer of the same environment:** the issuing DID is preserved, the
authorized records and signature material is transferred for custody
separately encrypted.
- **Promotion from staging to production:** the productive profile is created and only
expressly approved records migrate. They are not copied automatically
credentials, keys or staging authorizations.

Without that decision, DNS is not changed or the actual migration is executed.

## 2. Information supplied by each responsible role

| Responsible role | Required handoff before continuing |
| --- | --- |
| Authority of the ICA | previous option, issuing DID, domains, sectors, jurisdictions and allowed hosts policy |
| Custodian of origin | export Firestore and directory `ica-audit/`, both encrypted and hashed |
| Kubernetes Operator | namespace, StorageClass, IngressClass, DNS/TLS, OCI record and backup policy |
| Data Operator | PostgreSQL URL, Kubo/IPFS Private API and Private Evidence Directory |
| Crypto Custodian | signing key injection mechanism; never mail, Git or ZIP |

## 3. Check the public migrator first

```bash
git clone https://github.com/Global-DataCare/dataspace-ica-ts.git
cd dataspace-ica-ts
npm ci
npm run evidence:migration:postgres-ipfs
```

Public reference: [PostgreSQL/IPFS migration](https://github.com/Global-DataCare/dataspace-ica-ts/blob/main/docs/06-architecture-and-reference/02-postgres-ipfs-gap.md).

Do not continue if the result does not contain `Migration PASS`.

## 4. Private migration trial using a copy

A Firestore managed export is neither SQL nor JSON. Import it first into a private temporary Firestore database or use the live source in read-only mode. Download `ica-audit/` preserving its relative paths.

```bash
export FIRESTORE_PROJECT_ID='<proyecto-firestore-temporal-o-origen>'
export ICA_MIGRATION_CONFIRM_SOURCE_PROJECT="${FIRESTORE_PROJECT_ID}"
export ICA_MIGRATION_SOURCE_COLLECTIONS_PREFIX='<source-prefix>'
export ICA_MIGRATION_TARGET_COLLECTIONS_PREFIX='<target-prefix>'
export ICA_MIGRATION_AUDIT_SOURCE_DIR='/secure/migration/gcs'
export ICA_MIGRATION_OUTPUT_DIR='/secure/migration/evidence/trial-001'
export POSTGRES_URL='<url-postgresql-privada>'
export IPFS_API_URL='<api-kubo-privada>'
export ICA_MIGRATION_IPFS_CUSTODY='private-encrypted'
export ICA_MIGRATION_DATA_PROTECTION_CONFIRMED='true'

node src/api/scripts/migrate-firestore-gcs-to-postgres-ipfs.ts --apply
```

The mandatory output is:

- `Migration PASS`;
- zero unresolved GCS references;
- transformed source digest equal to that of PostgreSQL;
- each CID recoverable and with the expected SHA-256.

## 5. Deploy the new ICA without changing DNS

The verified OCI image of the data-space ICA is posted at:

- [package `dataspace-ica`](https://github.com/orgs/Global-DataCare/packages/container/package/dataspace-ica);
- `ghcr.io/global-datacare/dataspace-ica@sha256:2e0faee426f7e1c438409a99ae2ab61f4aa21fc1ef615de3928ee1c020092053`.

The Kubernetes operator checks and uses that immutable digest:

```bash
export ICA_IMAGE='ghcr.io/global-datacare/dataspace-ica@sha256:2e0faee426f7e1c438409a99ae2ab61f4aa21fc1ef615de3928ee1c020092053'
docker pull "${ICA_IMAGE}"
docker buildx imagetools inspect "${ICA_IMAGE}"
```

The public Kubernetes templates for ICA are at [`deploy/k8s`](https://github.com/Global-DataCare/dataspace-ica-ts/tree/main/deploy/k8s). The Kubernetes operator materializes in its private inventory:

```dotenv
DB_PROVIDER=postgres
POSTGRES_URL=<secreto>
STORAGE_PROVIDER=ipfs
IPFS_API_URL=<secreto-o-url-interna>
ICA_COLLECTIONS_REQUIRED=true
ICA_AUDIT_STORAGE_REQUIRED=true
```

Additionally, configure the DID, public chain and signing key through its secrets manager. Boot ICA with a temporary name or try the new IP without changing DNS.

## 6. Acceptance and cutover

```bash
curl --fail --show-error https://<dominio-temporal-o-resuelto>/
curl --fail --show-error https://<dominio-temporal-o-resuelto>/.well-known/did.json
curl --fail --show-error https://<dominio-temporal-o-resuelto>/openapi.json >/tmp/ica-openapi.json
```

Afterwards, issuance, query, revocation, recovery of an object by CID, backup and restoration are tested. Only with all tests approved:

1. freeze writes at source;
2. repeat export and final migration;
3. check hashes and counts;
4. change DNS;
5. preserve the origin during the rollback window;
6. record commit, image digest, report and cut time.

The next phase is [`PROCEDURE_HOST_ONBOARDING_EN.md`](./PROCEDURE_HOST_ONBOARDING_EN.md).
