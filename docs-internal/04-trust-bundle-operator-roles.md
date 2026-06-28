# Trust Bundle Operator Roles

Status date: 2026-06-28

## Purpose

Clarify who does what when the reproducible trust bundle is generated and then
used together with local Fabric `local-network`.

## Domain CA Administrator

Runs in `gwtemplate-node-ts`:

```bash
npm run pki:root -- --json <root-ca-organization.json>
```

Responsibilities:

- protect the root private key
- publish Root CA `did.json`, `jwks.json`, and `x509.der`
- hand over public artifacts to the ICA operator

## ICA Domain Administrator

Runs in `gwtemplate-node-ts`:

```bash
npm run pki:ica -- --json <ica-organization.json> --ca-json <root-ca-organization.json> --ca-dir artifacts/test/pki-root-ca
```

Responsibilities:

- generate ICA trust artifacts signed by the Root CA
- publish ICA `did.json`, `jwks.json`, and `x509.der`
- configure `dataspace-ica-ts` to serve those exact files

## Host Operator

Runs in `gwtemplate-node-ts`:

```bash
npm run pki:host -- --json <host-organization.json> --ica-json <ica-organization.json> --ica-dir <generated-ica-dir> --ca-dir artifacts/test/pki-root-ca
```

Responsibilities:

- generate the host identity-signing trust material
- keep Fabric operational keys separate from identity-signing keys
- run GW CORE against `.env.local-fabric`

## Tenant or Member Operator

Runs in `gwtemplate-node-ts`:

```bash
npm run pki:member -- --json <member-organization.json> --ica-json <ica-organization.json> --ica-dir <generated-ica-dir> --ca-dir artifacts/test/pki-root-ca
```

Responsibilities:

- generate tenant or member public identity material
- publish tenant `did.json`, `jwks.json`, and `x509.der` when that tenant is a
  public signer

## Local Fabric Lifecycle Owner

The lifecycle owner for `local-network` is still `gwtemplate-node-ts`.

Use:

```bash
npm run local:fabric:stack
```

This repo owns:

- Fabric bootstrap
- `.env.local-fabric`
- GW startup
- packaged local audit demo

`gdc-sdk-node-ts` remains the consumer-side proof layer.
