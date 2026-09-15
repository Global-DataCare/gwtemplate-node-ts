# Flow contract: an AWS-backed GW running outside AWS obtains renewable temporary credentials from the official IAM Roles Anywhere helper without static AWS access keys or application-code changes.
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART="${ROOT}/charts/gdc-host"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

VALUES="${TMP_DIR}/aws-roles-anywhere.yaml"
RENDERED="${TMP_DIR}/rendered.yaml"
cp "${CHART}/ci/production-values.yaml" "${VALUES}"

# These neutral ARNs and Secret names are exact Helm rendering fixtures, not
# deployable identities. Production supplies its own existing Secret and ARNs.
yq -i '
  .gw.providers.kms = "aws" |
  .gw.awsCredentials.mode = "roles-anywhere" |
  .gw.awsCredentials.rolesAnywhere.image = "public.ecr.aws/rolesanywhere/credential-helper@sha256:d06f1c35dd683d6f67c950fec3e39b3599bca5471acf05d8554650299d1029d7" |
  .gw.awsCredentials.rolesAnywhere.existingSecret = "example-aws-workload-x509" |
  .gw.awsCredentials.rolesAnywhere.certificateKey = "tls.crt" |
  .gw.awsCredentials.rolesAnywhere.privateKeyKey = "tls.key" |
  .gw.awsCredentials.rolesAnywhere.trustAnchorArn = "arn:aws:rolesanywhere:eu-central-1:111122223333:trust-anchor/00000000-0000-0000-0000-000000000001" |
  .gw.awsCredentials.rolesAnywhere.profileArn = "arn:aws:rolesanywhere:eu-central-1:111122223333:profile/00000000-0000-0000-0000-000000000002" |
  .gw.awsCredentials.rolesAnywhere.roleArn = "arn:aws:iam::111122223333:role/example-gw-kms-decrypt" |
  .gw.awsCredentials.rolesAnywhere.region = "eu-central-1"
' "${VALUES}"

helm lint --strict "${CHART}" -f "${VALUES}"
helm template aws-host "${CHART}" --namespace aws-host -f "${VALUES}" > "${RENDERED}"

grep -Fq 'name: aws-roles-anywhere' "${RENDERED}"
grep -Fq 'image: "public.ecr.aws/rolesanywhere/credential-helper@sha256:d06f1c35dd683d6f67c950fec3e39b3599bca5471acf05d8554650299d1029d7"' "${RENDERED}"
grep -Fq -- '- serve' "${RENDERED}"
grep -Fq -- '- --certificate' "${RENDERED}"
grep -Fq -- '- "/var/run/secrets/aws-roles-anywhere/tls.crt"' "${RENDERED}"
grep -Fq -- '- --private-key' "${RENDERED}"
grep -Fq -- '- "/var/run/secrets/aws-roles-anywhere/tls.key"' "${RENDERED}"
grep -Fq -- '- --trust-anchor-arn' "${RENDERED}"
grep -Fq -- '- --profile-arn' "${RENDERED}"
grep -Fq -- '- --role-arn' "${RENDERED}"
grep -Fq -- '- --region' "${RENDERED}"
grep -Fq -- '- "eu-central-1"' "${RENDERED}"
grep -Fq 'name: AWS_EC2_METADATA_SERVICE_ENDPOINT' "${RENDERED}"
grep -Fq 'value: "http://127.0.0.1:9911"' "${RENDERED}"
grep -Fq 'secretName: example-aws-workload-x509' "${RENDERED}"

if grep -Eq 'AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY' "${RENDERED}"; then
  echo 'Roles Anywhere rendered forbidden long-lived AWS access keys' >&2
  exit 1
fi

MISSING_SECRET="${TMP_DIR}/missing-secret.yaml"
cp "${VALUES}" "${MISSING_SECRET}"
yq -i '.gw.awsCredentials.rolesAnywhere.existingSecret = ""' "${MISSING_SECRET}"
if helm template invalid "${CHART}" -f "${MISSING_SECRET}" >/dev/null 2>&1; then
  echo 'chart accepted Roles Anywhere without an X.509 Secret' >&2
  exit 1
fi

WRONG_PROVIDER="${TMP_DIR}/wrong-provider.yaml"
cp "${VALUES}" "${WRONG_PROVIDER}"
yq -i '.gw.providers.kms = "gcp"' "${WRONG_PROVIDER}"
if helm template invalid "${CHART}" -f "${WRONG_PROVIDER}" >/dev/null 2>&1; then
  echo 'chart accepted Roles Anywhere for a non-AWS KMS provider' >&2
  exit 1
fi

echo 'AWS Roles Anywhere Helm contract passed'
