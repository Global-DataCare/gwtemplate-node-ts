# GW CORE deployment target

Keep the deployable GW CORE service distinct from product-specific gateways.
Resolve the concrete target from the operator's untracked inventory; never put
real project names, domains, public addresses or custody mappings in this
public skill.

Before every mutation, obtain and verify these values:

- cloud project or account;
- region and cluster;
- Kubernetes namespace, Deployment and Service;
- immutable registry repository and image digest;
- reserved address resource, without printing its address;
- deployment profile and network mode;
- storage layout and encrypted-key custody boundary.

Abort if the selected Kubernetes context, workload labels or reserved address
resource do not match the intended GW CORE target. Infrastructure names are
not product identities and must not be used to infer the environment.

Validate the image locally first. For a remote release, use an exact
commit-derived tag, resolve the pushed digest, deploy by digest and verify both
the rollout and live image identity. Never copy authentication trust or
plaintext key material between environments merely because two deployments
share storage during a temporary migration.
