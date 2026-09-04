# Host onboarding procedure: test-network and production

This guide starts after the data-space ICA is operational. It does not migrate staging identities into production: each network receives new identities, certificates, Secrets and PVCs.

## 1. Responsibilities

Each phase is assigned to one of these roles:

| Role | Responsibility | Boundary |
| --- | --- | --- |
| Governance Committee | Approves the applicable procedure and agreements on channels | Does not execute daily technical operation |
| Responsible for technical validation | Validates the addition in accordance with section 10.4 of the Rulebook: the Data Space Operator when designated or, failing that, the host Node Operator and the corresponding ICA | Does not generate the private key of the new Node Operator |
| Data-space ICA operator | Configures preauthorization, creates a one-time activation and maintains the issuance endpoint | Does not issue Fabric MSP/TLS certificates |
| Node Operator DevOps team | Generates and safeguards the host key, requests the Host VC and deploys Helm | Does not receive the Fabric ICA registrar identity |
| Entity authorized to administer Fabric | Safeguards the Fabric ICA registrar identity and each MSP administrator | Does not receive the private keys of the peer, TLS or GW client |
| Fabric DevOps team | Validates the Host VC, registers the grants and executes the agreed channel changes | Does not deliver administrative identities to Node Operator |

The **data-space ICA** issues the `HostingServiceCredential`. The **Fabric ICA** then issues the X.509 MSP/TLS certificates. They are different services, credentials and responsibilities.

The **Fabric ICA registrar identity** and the **MSP administrator** are different identities. Both are **Fabric administrative identities**. The first registers enrollment identifiers in the Fabric ICA; the second administers the MSP during authorized configuration and lifecycle operations. The **entity authorized to administer Fabric** safeguards both identities, and the **Fabric DevOps team** uses them to execute approved operations. The Node Operator DevOps team receives neither identity: it receives only temporary enrollment grants.

A temporary enrollment grant is not a certificate. It contains the temporary enrollment ID and secret needed to request a certificate from the Fabric ICA. When the grant is consumed, the private key is generated inside the Node Operator infrastructure and the Fabric ICA returns the X.509 certificate. The peer grant permits the MSP and TLS enrollments; the GW client grant permits its MSP enrollment. A grant does not add the peer to any channel. The Fabric ICA returns the certificates directly to the Node Operator. They do not pass through the Fabric DevOps team.

This guide uses **Node Operator, acting as a Hosting Provider for organizations that provide or consume index or digital-twin services**, with the meaning defined in the Rulebook: the accredited technical infrastructure that hosts participants and provides services in the Data Space. The **Node Operator DevOps team** executes the deployment and operation commands described below.

In accordance with section 10.4 of the Rulebook, the Node Operator must demonstrate technical capability, identity and trust mechanisms, artifact publication and Compute-to-Data controls where applicable. Its authorization requires the technical validation specified in that section. Rulebook section 13.3 assigns it contractual and regulatory obligations concerning security, infrastructure availability and data protection.

## Complete host onboarding procedure

The data-space ICA operator generates a one-time activation from the pod. Shell redirection saves the file on the operator's workstation. The Node Operator DevOps team receives the file through a secure channel and uses the host assistant to send the activation, JWK public key and signed request to the ICA. The ICA issues the `HostingServiceCredential` for the approved host.

The Node Operator DevOps team then delivers that credential to the Fabric DevOps team. The MSP identifier is assigned under the approved procedure; the Node Operator does not choose it unilaterally. The Fabric DevOps team verifies the credential, provisions the MSP administrator under the custody of the entity authorized to administer Fabric and registers two temporary enrollment grants with the Fabric ICA: a two-use grant for the host to generate its MSP identity and peer TLS certificate locally, and a one-use grant for the GW client identity. The Node Operator DevOps team receives those temporary enrollment IDs and secrets together with the public Fabric ICA TLS chain. When it runs the assistant, private keys are generated and remain within the Node Operator infrastructure; the Fabric ICA returns the corresponding certificates directly.

The MSP administrator remains under the custody of the entity authorized to administer Fabric and is never delivered to the Node Operator. The Fabric DevOps team produces the public MSP definition from the issuing chain and public administrative certificate. The Node Operator communicates only its endpoint and the public certificates or verification fingerprints produced by the assistant.

Certificates certify identities, but channel membership is governed separately. If the same Node Operator and administrative scope reuse an already supported MSP, another MSP is not created: new identities are issued to the peer and their addition is checked.

## 2. Agree and approve the onboarding record

The Node Operator DevOps team does not execute the registration until the formal approval and the technical data have been reflected in this sheet. The fields marked as approval ICA are then copied, without changes, to the file `approved-host.json` from step 5:

```text
Environment (ICA approval): test-network | network
Host HTTPS domain (ICA approval):
Data-space ICA URL:
Jurisdiction (ICA approval):
Issuance context (ICA approval):
Node Operator legal name (ICA approval):
VAT/TAX/official identifier (ICA approval):
Country:
Host controller email (ICA approval):
Stable controller identifier:
Controller ISCO-08 role:
MSP assigned under the approved procedure:
Channels agreed under the approved procedure:
Fixed egress IP towards the Fabric ICA:
Namespace and Helm release:
StorageClass and IngressClass:
GW and peer DNS/TLS:
```

Formal approval confirms in writing legal identity, domain, controller, issuance context and environment. Fabric DevOps team confirms the MSP and channels according to the approved procedure. A staging authorization is used in `test-network`; for `network` everything is repeated with a new productive authorization. These approvals do not configure Kubernetes on their own: each team then applies only its portion.

## 3. Node Operator DevOps team: prepare checkout and private manifest

```bash
git clone https://github.com/Global-DataCare/gwtemplate-node-ts.git
cd gwtemplate-node-ts
npm ci

install -d -m 700 /secure/host/bootstrap /secure/onboarding /secure/inventory
cp configs/host-credential-request.example.json \
  /secure/onboarding/host-credential-request.json
chmod 600 /secure/onboarding/host-credential-request.json
```

`host-credential-request.json` is the input file for the command in step 4. It does not yet contain the credential or a private key. Gather in one place the data needed by the command:

- which data-space ICA should call;
- which domain and Node Operator are being authorized;
- if the registration corresponds to staging or production;
- in which private routes you should create the key and save the obtained credential.

```text
Formal domain and network approval
        |
        +-- ICA operator ------> creates host-activation.json from the pod
        |                         and captures it on the operator workstation
        |
        +-- private handoff ---> DevOps team receives the activation
        |
        +-- --init command ----> generates the private request key
        |
        +-- --request command -> sends activation + JWK + signature
        |                         and receives host-credential.json
        |
        +-- Helm starts GW -----> GW/KMS generates and publishes the operational DID
```

The application carries the public JWK and `kid`; The signature demonstrates possession of the private key and the single-use activation certifies the prior authorization registered in the ICA. `thid` only maps asynchronous operation and is never used as a password.

It is kept outside of Git because it contains the actual data of Node Operator and the controller and because it references the paths where private materials will be created. The Node Operator DevOps team starts from this structure for production:

```json
{
  "verifyUrl": "https://ica.example.org/ica/cds-ES/v1/onehealth-research/network/pdf/contract/_verify",
  "hostDomain": "host.provider.example",
  "serviceUrl": "https://host.provider.example",
  "jurisdiction": "ES",
  "sector": "onehealth-research",
  "networkKind": "network",
  "legalName": "<approved-legal-name>",
  "addressCountry": "ES",
  "taxId": "<approved-tax-identifier>",
  "controllerEmail": "<approved-controller-email>",
  "privateJwkFile": "/secure/host/bootstrap/host-signing.private.jwk.json",
  "activationFile": "/secure/onboarding/host-activation.json",
  "credentialOutputFile": "/secure/host/bootstrap/host-credential.json"
}
```

The Node Operator DevOps team replaces only the values between `<...>` and the two `.example` domains. Paths under `/secure` are private locations in the host environment, not paths in the ICA pod. They may be adapted while preserving permissions and updating the manifest consistently.

Meaning of the fields that usually cause confusion:

| Field | Value to be entered |
| --- | --- |
| `verifyUrl` | Exact URL provided by the data-space ICA operator |
| `hostDomain` | Domain of the new host, without `https://` or routes |
| `serviceUrl` | The same domain as above with `https://` |
| `jurisdiction` | Country or jurisdiction under which the credential is issued |
| `sector` | Sectoral context of the ICA verification transaction; `onehealth-research` is only the value of this example |
| `networkKind` | `test-network` for staging or `network` for production |
| `privateJwkFile` | Path where the command will create the request's private key |
| `activationFile` | Private file received from the operator of ICA; contains single-use activation |
| `credentialOutputFile` | Path where the command will save the issued Host VC |

`verifyUrl` is not invented from the host domain. It is the HTTP endpoint of the **data-space ICA** that receives the request and issues the Host VC. The `_verify` suffix is ​​just the name of that HTTP operation; It is not another service or a file. ICA DevOps should deliver the full URL.

### Do not confuse environment, emission context and hosted sectors

There are three different configurations:

| Settings | Example | What controls |
| --- | --- | --- |
| `networkKind` / Helm `networkMode` | `test-network` or `network` | Staging or production network to which the host belongs |
| Transaction `sector` ICA | `onehealth-research` in this example | Sector context that requires the ICA shared verification path and also uses the organization credential issued in that transaction |
| Helm `host.allowedSectors` | list of business sectors | Sectors whose operations the GW supports |

The `HostingServiceCredential` credits the URL and the Node Operator, and its subject does not contain that sector. The shared operation of the ICA however requires a `{sector}` as the emission context. The host's own internal registry uses the reserved technical category `system`. The host can support multiple sectors using `host.allowedSectors`, as long as formal authorization, channels, and deployed policies authorize them.

Therefore, just because the manifest above uses `sector: onehealth-research` does not mean that the host can only host that sector. If the approval sets `health-care`, both the field and segment of `verifyUrl` must use `health-care`; They don't mix. The effective list of supported sectors is then configured in Helm values, for example:

```yaml
networkMode: network
host:
  allowedSectors:
    - onehealth-research
    - health-care
    - health-research
    - animal-research
```

In the GW's own log paths, the history parameter named `{sector}` actually receives the host environment (`local-network`, `test-network`, or `network`). The business sectors remain separate in `host.allowedSectors`.

The owning or operating organization is used at boot to create the internal reserved record `host` and its initial controller.

If ICA only has internal access through `ClusterIP`, DevOps executes the request from a machine or Job with access to that internal URL. If you have public HTTPS DNS, use its public URL. The team operating ICA must provide the exact URL; Node Operator DevOps team should not guess it.

For `test-network`, the three consistent values are:

```text
networkKind: test-network
hostDomain: approved staging domain
verifyUrl: staging ICA route containing /test-network/
```

For production they are:

```text
networkKind: network
hostDomain: approved production domain
verifyUrl: production ICA route containing /network/
```

The private key and Host VC are not reused between environments.

## 4. Node Operator DevOps team: generate the request private key

```bash
node scripts/onboarding/request-host-credential.mjs \
  --manifest /secure/onboarding/host-credential-request.json --init
```

Exit:

- `host-signing.private.jwk.json`: request key; stays low
custody of Node Operator, mode `0600`.

The private key demonstrates that the authorized requester controls the signing of this request for the declared domain. It is not a Fabric key, it is not the GW's operational KMS key, and it is never sent outside of Node Operator.

The `--init` command generates the key automatically. `--request` will fetch the public JWK from it, include the `kid`, and sign the exact content without the operator having to build crypto manually.

After Helm is installed, the GW generates and safeguards its operational keys through the KMS adapter and automatically publishes the domain's operational DID at:

```text
https://<dominio-del-host>/.well-known/did.json
```

GW automatically generates and publishes that operational document.

## 5. Formal approval and data-space ICA operator: create the activation

The ICA operator verifies that the domain, legal identity, controller and environment match the formal approval. ICA keeps the domain and network allowed:

```dotenv
ICA_PREAUTHORIZED_HOST_DOMAINS=<dominio-exacto>
ICA_PREAUTHORIZED_HOST_NETWORK_KINDS=<test-network-o-network>
```

The ICA operator runs the following commands from a workstation with configured `kubectl` access. First, the operator creates a private copy of the approval and replaces the example values with the approved values; this step must not introduce or modify approval data:

```bash
export HOST_HANDOFF_DIR="${HOME}/gdc-host-handoff"
install -d -m 700 "${HOST_HANDOFF_DIR}"

cp configs/host-activation-approval.example.json \
  "${HOST_HANDOFF_DIR}/approved-host.json"
chmod 600 "${HOST_HANDOFF_DIR}/approved-host.json"
```

`approved-host.json` contains exactly domain, URL, network, jurisdiction, issuance context, legal identity and email of the controller. If Node Operator does not use `taxId`, replace that field with `identifierType` and `identifierValue`. Then the ICA operator sends it through the standard input of the command that runs in the pod:

```bash
kubectl --context '<context>' \
  --namespace '<namespace-ica>' \
  exec -i deployment/<deployment-ica> -- \
  node ./bin/ica-cli.js host:activation:create \
    --approval-stdin \
    --expires-in 72h \
    --created-by '<stable-ica-operator-id>' \
  < "${HOST_HANDOFF_DIR}/approved-host.json" \
  > "${HOST_HANDOFF_DIR}/host-activation.json"

chmod 600 "${HOST_HANDOFF_DIR}/host-activation.json"
```

The command is run inside the pod because it needs the same variables and database as ICA. The `<` character reads the approval from the local computer and sends it to the process without copying it to the pod disk. The `>` character saves the response to `${HOME}/gdc-host-handoff` on the computer that ran `kubectl`, not within the pod. In PostgreSQL or Firestore, the SHA-256 of the code remains along with the approved data, network, expiration and status; never the original code.

The output file contains the activation and a copy of the approved data. The operator of ICA delivers encrypted `host-activation.json` over a private channel. It does not copy it to Git, unencrypted email, WhatsApp, Helm, ConfigMap or logs. The Node Operator DevOps team saves it as `/secure/onboarding/host-activation.json` with mode `0600`. The activation expires, belongs to a single domain/network and is consumed only once. If it fails after being consumed, the ICA operator generates another one.

The ICA operator can check the metadata without displaying the code:

```bash
jq 'del(.activationCode)' "${HOST_HANDOFF_DIR}/host-activation.json"
```

## 6. Node Operator DevOps team: request the HostingServiceCredential

When Node Operator DevOps team has the private activation and key from step 4:

```bash
node scripts/onboarding/request-host-credential.mjs \
  --manifest /secure/onboarding/host-credential-request.json --request
```

Before calling ICA, the wizard verifies that all data in the manifest matches the approval included in the activation. It then signs and sends the request, waits for the result, and saves `host-credential.json` with the VC JSON and VC-JWT. Node Operator DevOps team does not need to manually build JWS, claims or HTTP calls.

Do not continue if the credential does not contain `HostingServiceCredential`, if its subject is not the exact host URL, or if the controller/legal identity does not match the approval.

Up to this point only the accommodation service has been authorized. No MSP/TLS certificates have been generated yet nor have any peers been added to Fabric.

<a id="7-fabric-administrator-register-and-custody-the-msp-administrator"></a>

## 7. Fabric DevOps team: register and manage the MSP administrator

The Node Operator DevOps team delivers via secure channel:

- Host VC-JWT;
- domain and MSP assigned according to the approved procedure;
- approved channels;
- Fixed output IP.

**Fabric DevOps team**, not Node Operator DevOps team nor the ICA operator of the data space, adds that MSP to the governed inventory. The value of `mspId` included in the request must exactly match the signed decision: the host cannot invent or modify the name. Then use Fabric ICA registrar identity and run the public wizard:

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role authority

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role authority \
  --apply --confirm-request '<request-id-firmado>'
```

The wizard creates under the paths `authority.mspAdminOutputDir` and `authority.publicMspOutputDir`:

- the identity and private key `<MSP>.admin`, in the custody of the entity
authorized to manage Fabric;
- the healthy public definition of the MSP, without secrets or private keys.

The same contract can be audited separately with `scripts/enrollment/provision-governed-msp-admin.sh`. If both routes already exist and match in MSP, network, and Fabric ICA, the wizard reuses the identity without registering it again; If the managed material is incomplete or does not match, it stops without overwriting it. Thus, several approved peers of the same Node Operator can belong to the same MSP. `authority.caName` identifies the exact Fabric ICA and is preserved in both grants so that the host cannot accidentally enroll against another CA.

Output to Node Operator DevOps team: a private encrypted packet, verifiable by its hash manifest and composed exactly of:

```text
peer-enrollment-grant.json
gw-client-enrollment-grant.json
fabric-ica-ca-chain.pem
fabric-endpoints.json
authorization.json
host-apply-confirmation.json
onboarding.host.json
manifest.sha256
```

`authorization.json` is the sanitized result that links the verified Host VC, domain, network, MSP, and approved channels; does not contain the VC-JWT. `host-apply-confirmation.json` contains the `requestId` that secures the application, and `onboarding.host.json` sets only the private routes and exits used by the `host` role. The MSP administrator, the Fabric ICA registrar identity, the complete network inventory, or private keys in the custody of the entity authorized to administer Fabric are never delivered.

## 8. Node Operator DevOps team: generate MSP/TLS inside the host

```bash
cd /secure/onboarding
shasum -a 256 -c manifest.sha256
request_id="$(jq -r '.governanceDecision.decision.requestId' \
  host-apply-confirmation.json)"

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.host.json --role host

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.host.json --role host \
  --apply --confirm-request "${request_id}"
```

Output: Peer MSP/TLS, GW client identity, `gw.fabric.env` and sanitized package for Kubernetes. Private keys never leave the host.

## 9. Node Operator DevOps team: configure and install the common chart

The values must contain the Node Operator's legal identity, initial controller and allowed sectors. The email must match the controller approved in the Host VC request:

```yaml
networkMode: network
host:
  legalName: <approved-legal-name>
  idType: <identifier-type>
  idValue: <legal-identifier>
  adminEmail: <approved-controller-email>
  adminUid: <stable-controller-identifier>
  adminRole: <ISCO-08-role>
  allowedSectors:
    - <authorized-sector>
peer:
  channels:
    - identity-global
    - identity-eu
    - health-care-eu
    - animal-pet-eu
```

Upon boot, GW automatically creates the reserved technical record `host`, generates its KMS keys, and publishes its operational DID. That record represents Node Operator.

`peer.channels` contains Fabric channels, not GW sectors. It should list all channels already approved for the MSP that the new peer should join. Helm validates and injects the list, while Fabric DevOps team performs and verifies the effective join.

```bash
helm pull oci://ghcr.io/global-datacare/gdc-host --version 0.3.2

bash scripts/validate-host-helm-values.sh \
  /secure/inventory/host.values.yaml '<namespace>' '<release>'

helm upgrade --install '<release>' oci://ghcr.io/global-datacare/gdc-host \
  --version 0.3.2 --namespace '<namespace>' --create-namespace \
  --values /secure/inventory/host.values.yaml \
  --atomic --wait --timeout 15m
```

`values` references already created Secrets for MSP, TLS, Authorization, GW, PostgreSQL, and CouchDB. They do not contain keys, grants, VC-JWT or passwords.

## 10. Fabric DevOps team: admit the MSP and accept the host

When the peer is reachable, the Node Operator communicates its endpoint and the public verification information produced during enrollment. It does not deliver private MSP directories. The Fabric DevOps team uses the governed public MSP definition to add the MSP to the channels and the safeguarded `<MSP>.admin` identity to join the peer and approve that organization's chaincode lifecycle.

The Fabric DevOps team applies the reconciler with its private inventory:

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role platform

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role platform \
  --apply --confirm-request '<request-id-firmado>'
```

The Node Operator DevOps team and Fabric DevOps team check pods, PVCs, peers, channels, CCAAS, write, read, deny, reset, and restore. A pod in state `Running` is not an accept.

The extended technical guide is at [`GUIDE_HOST_OPERATIONS_EN.md`](./GUIDE_HOST_OPERATIONS_EN.md).
