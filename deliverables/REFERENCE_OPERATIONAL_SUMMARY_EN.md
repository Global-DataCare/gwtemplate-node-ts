# Operational summary and public references

Forwardable text for the responsible team:

> The process is divided into three public procedures. First, reproduce the
> local deliverable without real data. Next, migrate or promote the data-space
> ICA. After validating that ICA, onboard the host in `test-network`; repeat the
> procedure with new identities for production. Each guide identifies the team
> responsible for every step, the file handed to the next team and the point at
> which each team must stop.
>
> 1. Reproducible local deliverable:
> https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/deliverables/EVIDENCE_REPRODUCIBLE_LOCAL_EN.md
>
> 2. Data-space ICA migration or promotion:
> https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/deliverables/MIGRATION_AND_DEPLOYMENT_ICA_EN.md
>
> 3. Host onboarding in test-network and production:
> https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/deliverables/PROCEDURE_HOST_ONBOARDING_EN.md
>
> Bootstrap and Host VC request tool:
> https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/scripts/onboarding/request-host-credential.mjs
>
> From its pod, the data-space ICA generates a one-time activation bound to the
> approved domain, network, legal identity, controller, jurisdiction and
> issuance context. `kubectl exec -i` reads the approval from the operator's
> workstation and redirects the activation back to that workstation. It is
> transferred to the Node Operator DevOps team through an encrypted channel.
>
> Public Helm chart:
> https://github.com/orgs/Global-DataCare/packages/container/package/gdc-host
>
> Through a secure channel, the Node Operator DevOps team receives an encrypted
> private package containing `peer-enrollment-grant.json`,
> `gw-client-enrollment-grant.json`, `fabric-ica-ca-chain.pem`,
> `fabric-endpoints.json`, `authorization.json`,
> `host-apply-confirmation.json`, `onboarding.host.json` and
> `manifest.sha256`. It verifies the hashes before running the `host` role. The
> Host VC-JWT, PDF, MSP administrator, Fabric ICA registrar identity and full
> network inventory are not included in that package.

Real domains, IP addresses, email addresses, data, `values`, VC, enrollment
grants, MSP/TLS material, keys and Secrets are exchanged separately through a
private channel.
