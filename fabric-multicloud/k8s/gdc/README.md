# GDC Gateway on GKE

This directory contains a minimal GKE deployment skeleton for the GW host/connector.

It is intentionally separate from:
- the Hyperledger Fabric CA / orderer / peer manifests under `test-fabric-v3`
- `dataspace-ica-ts`, which should be treated as an external ICA service if used at all

Use a dedicated namespace such as `test-gdc-v1`. Do not colocate the GW deployment in the
same namespace as Fabric components. Do not assume any shared cluster or internal service DNS
with `dataspace-ica-ts`.

This demo variant is meant for the simplest public GKE exposure:
- a reserved static public IP
- a `LoadBalancer` Service
- plain HTTP by IP

## What these manifests assume

- Container image already built and pushed somewhere reachable by GKE.
- GW runs on port `3000`.
- Persistent providers in Kubernetes should normally be:
  - `DB_PROVIDER=firestore`
  - `STORAGE_PROVIDER=gcs`
- For pure demo mode you can also run with `.env.local` semantics:
  - `NODE_ENV=demo`
  - `QUEUE_PROVIDER=mem`
  - `DB_PROVIDER=mem`
  - `STORAGE_PROVIDER=mem`
- `ICA_URL_EXTERNAL` is optional and, if used, should point to a public `dataspace-ica-ts` URL.

## Required render variables

The deploy script renders the templates with these environment variables:

- `K8S_NAMESPACE_GDC`
- `GDC_IMAGE`
- `GDC_PUBLIC_URL`
- `GDC_STATIC_IP_NAME`
- `GCP_PROJECT_ID`
- `GCS_BUCKET_NAME`
- `GDC_GSA_EMAIL`
- `DATASPACE_ICA_EXTERNAL_URL` (optional)

## Secret handling

`secret.template.yaml` is only a template. Copy it outside git or generate a real Secret before deploy.

Minimum secret values:

- `KEK_SECRET`

Optional depending on runtime:

- `ICA_TLS_CA_PEM`
- `FIREBASE_API_KEY`
- Stripe / SendGrid secrets

## Deploy flow

1. Create or select the cluster.
2. Reserve a static public IP in GCP and choose its resource name for `GDC_STATIC_IP_NAME`.
3. Put the real IP in `GDC_PUBLIC_URL` using plain HTTP, for example `http://34.x.y.z`.
4. Create namespace `test-gdc-v1` or similar.
5. Create the real `gwtemplate-secret`.
6. Render and apply these manifests.
7. Optionally point `ICA_URL_EXTERNAL` at a public `dataspace-ica-ts` URL.
8. Wait for the `LoadBalancer` Service to get the reserved public IP.
9. Wait for `/host/.well-known/ping` to return `200`.
10. Run `demo:bootstrap-single-tenant` against `http://<public-ip>`.

## Demo deploy config

If this is only a demo deployment and you want the runtime to match `.env.local`, start from:

```bash
cp demo-deploy.config.example demo-deploy.config
source demo-deploy.config
```

That file is meant to source `.env.local` and only add the GKE / public-IP / ICA endpoint variables on top.
In the standalone demo case, the ICA variable can stay empty.
