# Guía operativa auditable para incorporar y desplegar un host

Esta guía es pública, neutral respecto del proveedor y válida para
`local-network`, `test-network` y `network`. Los dominios, endpoints, values,
credenciales y nombres reales se mantienen en un inventario privado. Nunca se
copian secretos en este repositorio ni en la salida de Helm.

Para una operación real, siga primero la guía corta
[`MIGRACION_Y_DESPLIEGUE_ICA_ES.md`](./MIGRACION_Y_DESPLIEGUE_ICA_ES.md) y
después [`PUESTA_EN_MARCHA_HOST_ES.md`](./PUESTA_EN_MARCHA_HOST_ES.md). Este
documento conserva el detalle técnico de referencia y no sustituye ese orden.

## 1. Resultado y roles

Una ejecución correcta deja una `HostingServiceCredential` VC-JWT, una
autorización vinculada a URL/MSP/red/canales, certificados MSP y TLS con claves
privadas generadas por el host, el MSP admitido en los canales, el runtime
instalado mediante Helm y evidencias de escritura, lectura, denegación y
persistencia.

| Rol | Responsabilidad | Entrega |
| --- | --- | --- |
| ICA del espacio de datos | Verifica evidencia o preautorización y emite la Host VC | `host-credential.jwt` y DID público de la ICA |
| Autoridad de red/Fabric ICA | Verifica VC, decisión y operador; registra el enrolamiento | `authorization.json`, `enrollment-grant.json`, cadena TLS de Fabric CA |
| Proveedor del host | Genera claves y solicita certificados MSP/TLS | identidad privada y paquete Helm saneado |
| Operador de red | Admite el MSP y gobierna canales/lifecycle | estado y auditoría del reconciliador |
| Operador Kubernetes | Crea Secrets, instala Helm y verifica | release, rollouts y evidencias operativas |

La ICA del espacio de datos y la ICA de Fabric son servicios distintos. La Host
VC no sustituye a los certificados X.509 de Fabric. El proveedor nunca recibe
la identidad administradora de Fabric CA.

## 2. Requisitos

- Node.js 22+, Docker/Compose, `jq`, OpenSSL y Git.
- Helm 3, `kubectl` y acceso al clúster; `kind` solo para la prueba local.
- `fabric-ca-client` para el rol host.
- registro OCI accesible por el clúster e imágenes fijadas por `@sha256` fuera
  de local.
- conectividad del peer hacia orderer, peers de bootstrap y Services CCAAS.

```bash
export REPO_ROOT="$(pwd)"
cd "${REPO_ROOT}"
npm ci
git status --short
```

## 3. Prueba completa del auditor en local-network

Declare las rutas de los checkouts públicos; no las codifique en documentos:

```bash
export DATASPACE_CA_ROOT="/ruta/al/checkout/dataspace-ca-ts"
export DATASPACE_ICA_ROOT="/ruta/al/checkout/dataspace-ica-ts"
release_tag="$(node -p "require('./package.json').version")-$(git rev-parse --short HEAD)"
export IMAGE_NAME="gw-core:${release_tag}"

LOCAL_IMAGE_NAME="${IMAGE_NAME}" ./docker_build_local.sh
npm run evidence:open-source-production-readiness
```

El auditor conserva el directorio anunciado bajo
`artifacts/open-source-production-readiness/`, comprueba que todos los ficheros
de `gates/` contienen `PASS` y verifica los hashes. El recolector prueba CA e
ICA desechables, Fabric Docker con `Host1MSP`/`Host2MSP`, PostgreSQL/IPFS y un
clúster kind donde Helm instala peer, CouchDB, GW y nueve CCAAS. Ejecuta
Consent/SMART, controles negativos y reinicios.

El mismo recolector ejecuta el gate público de migración de la ICA desde
Firestore/GCS a PostgreSQL/IPFS. Solo usa fixtures sintéticas; los PDF firmados,
credenciales y claves reales permanecen fuera del repositorio y de la evidencia
pública.

Puertas separadas:

```bash
IMAGE_NAME="${IMAGE_NAME}" npm run docker:smoke:open-source-local-network
npm run helm:test:host
IMAGE_NAME="${IMAGE_NAME}" npm run helm:smoke:local-network
```

## 4. Inventario privado para test-network o producción

```bash
install -d -m 700 /secure/onboarding /secure/inventory /secure/host
cp configs/host-onboarding.production.example.json /secure/onboarding/onboarding.json
cp charts/gdc-host/ci/production-values.yaml /secure/inventory/host.values.yaml
chmod 600 /secure/onboarding/onboarding.json /secure/inventory/host.values.yaml
```

En `test-network`, cambie a `environment: staging`, `networkMode:
test-network` y autoridades/credenciales de staging. En producción use
`environment: production`, `networkMode: network` y credenciales nuevas. Nunca
copie MSP, TLS, VC, grant, Secret o KEK entre entornos.

El inventario fija URL, `mspId`, orderer, bootstrap peers, canales, namespace,
release, StorageClass, IngressClass, DNS/TLS, digests OCI, package IDs CCAAS,
adaptador KMS, backups, observabilidad, NetworkPolicies y puertos.

## 5. Fase A: autoridad y Fabric ICA

### 5.1 Apertura controlada y comprobación desde el proveedor

La ICA de Fabric no participa en el tráfico normal de gossip, endoso, canales
o consenso. Se necesita para alta inicial, renovación, revocación e
incorporación de hosts. Por tanto, su LoadBalancer público puede limitarse a la
IP fija de salida del proveedor y cerrarse después del enrolamiento.

La autoridad conserva en su repositorio privado el procedimiento para abrir,
restringir y cerrar esa ventana. Al proveedor sólo se le entregan la URL HTTPS,
el nombre de CA y la cadena pública. Antes de consumir ningún grant comprueba:

```bash
export FABRIC_CA_URL='https://fabric-ica.example.org:443'
export FABRIC_CA_NAME='ca-ica'
export FABRIC_CA_TLS_CERTFILES=/secure/trust/fabric-ica-ca-chain.pem

fabric-ca-client getcainfo \
  -u "${FABRIC_CA_URL}" \
  --caname "${FABRIC_CA_NAME}" \
  --tls.certfiles "${FABRIC_CA_TLS_CERTFILES}"
```

La identidad registradora de la ICA de Fabric nunca se entrega al proveedor.
La autoridad registra los identificadores y secretos acotados; el proveedor
los consume para generar sus claves privadas y certificados en su propia
infraestructura.

La autoridad recibe por canal seguro la petición con URL/MSP/Host VC-JWT, el
envelope de gobernanza firmado, DID públicos, JWKS del operador y el inventario
gobernado. Primero revisa el plan:

```bash
request_id="$(jq -r '.governanceDecision.decision.requestId' \
  /secure/approvals/host-enrollment-request.json)"

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role authority
```

Tras revisar URL, MSP, red, digest, emisor y sujeto de la Host VC:

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role authority \
  --apply --confirm-request "${request_id}"
```

`authorization.json` no contiene la VC-JWT. El asistente crea dos grants
privados en modo `0600`: uno admite exactamente dos enrolamientos —MSP y TLS
del peer— y otro admite un único enrolamiento para la identidad cliente del GW.
Ambos contienen `issuedAt`/`expiresAt`. La fecha es una ventana aplicada por
estos helpers; Fabric CA garantiza sus límites de usos. La autoridad revoca
cualquier identificador que no se consuma dentro de la ventana.

## 6. Fase B: proveedor del host

Se transfieren únicamente los dos grants `0600` y la cadena TLS pública de Fabric CA.
El proveedor ejecuta plan y aplicación:

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role host

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role host \
  --apply --confirm-request "${request_id}"
```

El asistente invoca los contratos públicos de enrolamiento. Si se ejecuta el
procedimiento por pasos para una auditoría, los puntos de entrada son:

```bash
ENROLLMENT_GRANT_FILE=/secure/grants/peer-grant.json \
HOST_MSP_OUTPUT_DIR=/secure/host/fabric-peer \
HOST_PEER_DNS="${HOST_PEER_DNS}" \
CA_TLS_CERT=/secure/trust/fabric-ica-ca-chain.pem \
  bash scripts/enrollment/enroll-host-msp.sh

ENROLLMENT_GRANT_FILE=/secure/grants/gw-client-grant.json \
HOST_CLIENT_OUTPUT_DIR=/secure/host/fabric-gw-client \
CA_TLS_CERT=/secure/trust/fabric-ica-ca-chain.pem \
  bash scripts/enrollment/enroll-host-client.sh
```

El primero genera MSP y TLS del peer bajo la ruta privada del host; el segundo
genera una identidad cliente distinta para GW CORE. Sus variables y rutas se
materializan desde el manifiesto privado y los grants, no se escriben en el
chart ni en un ConfigMap.

`fabric-ca-client` genera dentro del host las claves MSP/TLS del peer y la clave
de una identidad cliente GW independiente; solo envía CSR y recibe certificados.
El asistente produce además `/secure/host/gw.fabric.env`, privado y en modo
`0600`, con `LEDGER_FABRIC_MSP_ID`, endpoint/TLS del peer y certificado/clave
cliente. Ningún grant aparece en ese fichero. El paquete
`/secure/host/helm-runtime` contiene únicamente:

Los certificados Fabric incluyen `gdc.hostCredentialSha256`, el SHA-256
hexadecimal del identificador completo de la Host VC. Se usa el digest porque
la sintaxis `:ecert` de Fabric CA no admite los `:` de un `urn:uuid`; el
identificador completo permanece en `authorization.json`.

```text
msp.tgz
tls.tgz
authorization.json
manifest.sha256
```

El grant, la Host VC-JWT y cualquier PDF quedan fuera. Verifique:

```bash
cd /secure/host/helm-runtime
shasum -a 256 -c manifest.sha256
```

## 7. Imágenes OCI y package IDs CCAAS

GW CORE no se publica en npm. La versión verificada está disponible en la
[página pública del paquete GW CORE](https://github.com/orgs/Global-DataCare/packages/container/package/gw-core).
El runtime común de los nueve chaincodes está disponible en la
[página pública del paquete CCAAS](https://github.com/orgs/Global-DataCare/packages/container/package/host-runtime).

GW CORE y CCAAS son artefactos OCI distintos. Use siempre sus digests:

```bash
export GW_PUBLIC_IMAGE="ghcr.io/global-datacare/gw-core@sha256:6b37c7dfea17dc2ee42628c5467fb5b44fe7f669536e695bd4f2932714485e5f"
export CCAAS_PUBLIC_IMAGE="ghcr.io/global-datacare/host-runtime@sha256:67e5c0fb93efbdc79812a3579ea0b9b0d8e230fca8d430c72e81666a7389f7ac"
docker buildx imagetools inspect "${GW_PUBLIC_IMAGE}"
docker buildx imagetools inspect "${CCAAS_PUBLIC_IMAGE}"
docker pull "${GW_PUBLIC_IMAGE}"
docker pull "${CCAAS_PUBLIC_IMAGE}"
```

El values de GW usa `GW_PUBLIC_IMAGE`. Cada entrada CCAAS usa la misma
`CCAAS_PUBLIC_IMAGE`, pero necesita su propio paquete `ccaas`; su
`connection.json.address` debe ser el Service exacto del release. El package ID
es `<label>:<sha256 del .tgz>`. Cambiar release, nombre completo, Service,
puerto o TLS obliga a regenerarlo.

Genere los nueve paquetes y el fragmento de values después de fijar el nombre
completo que Helm usará para los Services:

```bash
HOST_FULLNAME="${HELM_RELEASE}" \
KUBE_NAMESPACE="${KUBE_NAMESPACE}" \
CCAAS_IMAGE="${CCAAS_PUBLIC_IMAGE}" \
CCAAS_OUTPUT_DIR=/secure/onboarding/ccaas \
  bash scripts/onboarding/prepare-ccaas-packages.sh

shasum -a 256 -c /secure/onboarding/ccaas/manifest.sha256
```

El resultado enumera los nueve package IDs en `manifest.tsv` y produce
`chaincodes.values.yaml`. Para el perfil predeterminado, organizaciones y
empleados usan `identity-eu`, personas `identity-global` y el contrato de
consentimiento `health-care-eu`; cualquier cambio debe proceder del inventario
gobernado, no del proveedor.

## 8. Secrets e instalación Helm

Parta del fichero Fabric generado y añada únicamente la configuración privada
del despliegue en una copia bajo custodia del host:

```bash
cp /secure/host/gw.fabric.env /secure/host/gw.env
chmod 600 /secure/host/gw.env
# Añada mediante el gestor seguro KMS, proveedores y demás variables requeridas.
```

Prepare ficheros privados para PostgreSQL (`POSTGRES_USER`,
`POSTGRES_PASSWORD`), CouchDB (`username`, `password`) y GW (el fichero anterior,
configuración KMS y credenciales de proveedores). Si Redis está
habilitado, prepare también `REDIS_PASSWORD`:

```bash
export KUBE_CONTEXT="contexto-del-cluster"
export KUBE_NAMESPACE="namespace-del-host"
export HELM_RELEASE="nombre-del-host"

kubectl --context "${KUBE_CONTEXT}" create namespace "${KUBE_NAMESPACE}"

HOST_RUNTIME_DIR=/secure/host/helm-runtime \
POSTGRES_SECRET_ENV_FILE=/secure/host/postgresql.env \
COUCHDB_SECRET_ENV_FILE=/secure/host/couchdb.env \
GW_SECRET_ENV_FILE=/secure/host/gw.env \
REDIS_SECRET_ENV_FILE=/secure/host/redis.env \
  bash scripts/onboarding/materialize-kubernetes-secrets.sh
```

Se crean `<release>-peer-msp`, `<release>-peer-tls`,
`<release>-authorization`, `<release>-postgresql`, `<release>-couchdb` y
`<release>-gw` y, si se habilita, `<release>-redis`. El values debe
referenciarlos exactamente.

```bash
bash scripts/validate-host-helm-values.sh \
  /secure/inventory/host.values.yaml "${KUBE_NAMESPACE}" "${HELM_RELEASE}"

helm template "${HELM_RELEASE}" charts/gdc-host \
  --namespace "${KUBE_NAMESPACE}" \
  --values /secure/inventory/host.values.yaml > /secure/onboarding/rendered.yaml

helm pull oci://ghcr.io/global-datacare/gdc-host --version 0.3.0
tar -xzf gdc-host-0.3.0.tgz -C /secure/onboarding

helm upgrade --install "${HELM_RELEASE}" /secure/onboarding/gdc-host \
  --kube-context "${KUBE_CONTEXT}" --namespace "${KUBE_NAMESPACE}" \
  --values /secure/inventory/host.values.yaml \
  --atomic --wait --timeout 15m
```

No instale si el render contiene Secrets, VC-JWT, PDF, claves o imágenes sin
digest. En producción cada pod desenvuelve una vez la KEK de runtime mediante
el adaptador KMS; `KEK_SECRET` solo es válido en local/demo.

## 9. Gobernanza de Fabric

El operador revisa primero:

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role platform
```

El `commandMap` privado del operador define comandos reales `inspect`/`apply`
para admitir el MSP, aplicar grants, comprobar el peer, unir canales,
instalar/aprobar package IDs y confirmar definiciones mediante el MSP
gobernador. Nunca procede de la petición del host. Con el mapa revisado:

La prueba local no usa un mock: ejecuta
`scripts/governance/drivers/local-fabric-admission.mjs` contra Fabric viva. El
`commandMap` externo solo sustituye rutas, endpoints y credenciales por los del
operador sin cambiar el plan firmado ni el orden de convergencia.

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role platform \
  --apply --confirm-request "${request_id}"
```

El reconciliador re-inspecciona cada paso, es idempotente, conserva estado y
escribe auditoría JSONL. Si falta un comando real, falla cerrado; un mock no es
válido como prueba de aceptación externa.

## 10. Aceptación

```bash
kubectl --context "${KUBE_CONTEXT}" -n "${KUBE_NAMESPACE}" get pods,pvc,svc
kubectl --context "${KUBE_CONTEXT}" -n "${KUBE_NAMESPACE}" rollout status \
  statefulset/"${HELM_RELEASE}"-peer --timeout=5m
kubectl --context "${KUBE_CONTEXT}" -n "${KUBE_NAMESPACE}" rollout status \
  deployment/"${HELM_RELEASE}"-gw --timeout=5m
```

La aceptación demuestra: MSP/TLS esperados; solo los canales aprobados;
package IDs, aprobaciones y definiciones correctos; escritura/lectura mediante
el peer propio; permiso y denegación; persistencia PostgreSQL/IPFS tras reinicio
de GW, peer y CCAAS; y restauración según la política del proveedor. Un pod
arrancado no basta.

Entregue al auditor commit, digest OCI, chart, values saneado, versiones,
gates, logs saneados, auditoría y manifiesto de hashes. No entregue grants,
VC-JWT, PDFs, claves, env privados, tokens, IPs internas ni dumps. La prueba
local demuestra reproducibilidad del software; no afirma que una
infraestructura externa concreta ya esté desplegada.
