# Chart Helm portable de un host gobernado

`gdc-host` empaqueta un límite de host reutilizable en cualquier Kubernetes:

- peer de Fabric y CouchDB propiedad del host;
- GW CORE;
- PostgreSQL, IPFS/Kubo y Redis opcional;
- runtimes de chaincode CCAAS;
- Services e Ingress opcional.

El mismo chart se instala una vez por host. No se debe copiar ni bifurcar para
cada participante o proveedor de nube; las diferencias pertenecen al fichero
values privado de cada release.

## Límite de responsabilidad

Helm instala runtime. No autoriza el host, no emite certificados, no registra
identidades en la ICA de Fabric, no añade un MSP a canales y no aprueba ni
confirma chaincodes.

El orden correcto es:

1. la ICA del espacio de datos emite la `HostingServiceCredential`;
2. la autoridad verifica esa VC-JWT y la decisión de gobernanza;
3. la autoridad registra una identidad de dos enrolamientos en la ICA de Fabric;
4. el host ejecuta enrollment y genera localmente claves MSP/TLS;
5. el operador materializa Secrets y ejecuta Helm;
6. el reconciliador añade el MSP, une canales y aplica lifecycle CCAAS;
7. el E2E valida escritura, lectura, autorización y persistencia.

El chart recibe únicamente `authorization.json` saneado. La VC-JWT, un posible
PDF y los secretos de enrollment no entran en values, ConfigMaps ni manifiestos
renderizados.

La `HostingServiceCredential` es obligatoria en `local-network`,
`test-network` y `network`. El modo local sin PDF usa una Host VC emitida por
la ICA local para un host preautorizado; no omite la credencial. El grant añade
una ventana `issuedAt`/`expiresAt` comprobada por el helper, mientras que
Fabric CA impone de forma nativa `maxEnrollments=2`. La autoridad revoca los
identificadores no consumidos al vencer la ventana.

## Configuración y secretos

`values.yaml` contiene configuración no secreta y se proyecta a ConfigMap. Las
imágenes deben expresarse siempre por digest OCI:

```yaml
gw:
  image: registry.example/gw-core@sha256:<64 caracteres hexadecimales>
```

Antes de instalar, deben existir los Secrets referenciados:

| Value | Claves requeridas |
| --- | --- |
| `authorization.existingSecret` | `authorization.json` |
| `peer.mspSecretName` | `msp.tgz` |
| `peer.tlsSecretName` | `tls.tgz` |
| `peer.couchdbSecretName` | `username`, `password` |
| `postgresql.existingSecret` | `POSTGRES_USER`, `POSTGRES_PASSWORD` |
| `redis.existingSecret` | `REDIS_PASSWORD` |
| `gw.existingSecret` | identidad cliente Fabric, credenciales de proveedores y configuración secreta de KMS |

Ejemplo de forma de los comandos; los valores reales deben proceder del gestor
de secretos del proveedor:

```bash
kubectl -n <namespace> create secret generic <peer-msp-secret> \
  --from-file=msp.tgz=/secure/host/fabric-peer/msp.tgz
kubectl -n <namespace> create secret generic <peer-tls-secret> \
  --from-file=tls.tgz=/secure/host/fabric-peer/tls.tgz
kubectl -n <namespace> create secret generic <authorization-secret> \
  --from-file=authorization.json=/secure/onboarding/authorization.json
```

Los artefactos se empaquetan y los seis Secrets se convergen con helpers que no
imprimen sus valores:

```bash
HOST_IDENTITY_DIR=/secure/host/fabric-peer \
AUTHORIZATION_JSON=/secure/onboarding/authorization.json \
ENROLLMENT_GRANT_FILE=/secure/onboarding/enrollment-grant.json \
HOST_RUNTIME_OUTPUT_DIR=/secure/host/helm-runtime \
  bash scripts/onboarding/package-host-runtime.sh

KUBE_CONTEXT=<context> KUBE_NAMESPACE=<namespace> HELM_RELEASE=<release> \
HOST_RUNTIME_DIR=/secure/host/helm-runtime \
POSTGRES_SECRET_ENV_FILE=/secure/host/postgresql.env \
COUCHDB_SECRET_ENV_FILE=/secure/host/couchdb.env \
GW_SECRET_ENV_FILE=/secure/host/gw.env \
REDIS_SECRET_ENV_FILE=/secure/host/redis.env \
  bash scripts/onboarding/materialize-kubernetes-secrets.sh
```

En producción se recomienda External Secrets, Secret Store CSI o mecanismo
equivalente. `KEK_SECRET` solo es válido en local/demo. Cada pod de producción
debe desenvolver una vez su KEK de runtime mediante el adaptador KMS elegido.

## Perfiles

| Entorno | `environment` | `networkMode` | Uso |
| --- | --- | --- | --- |
| local | `local` | `local-network` | evidencia desechable |
| integración | `staging` | `test-network` | ensayo gobernado |
| producción | `production` | `network` | host autónomo persistente |

Los perfiles locales `ci/local-host1-values.yaml` y
`ci/local-host2-values.yaml` prueban límites distintos para `Host1MSP` y
`Host2MSP`. `ci/local-evidence-values.yaml` activa PostgreSQL e IPFS. Los
digests deliberadamente ficticios de los perfiles de render deben sustituirse
antes de una instalación.

## Validación estática

```bash
cd "${REPO_ROOT}"
npm run helm:test:host

bash scripts/validate-host-helm-values.sh \
  /secure/inventory/host.values.yaml \
  <namespace> \
  <release>
```

La validación ejecuta schema, lint estricto, render, dry-run cliente y controles
contra imágenes mutables, secretos renderizados, KEK local en producción y
perfiles incoherentes.

## Prueba Kubernetes real

Después de preparar la Fabric Docker y `.env.local-fabric`:

```bash
IMAGE_NAME="gw-core:<version-commit>" npm run helm:smoke:local-network
```

El script crea un `kind` aislado, carga la imagen ya probada y obtiene su digest
local, enrola una identidad exclusiva, instala peer/CouchDB/GW/PostgreSQL/IPFS
y nueve runtimes CCAAS, une el peer a los canales locales, instala y aprueba en
él los paquetes CCAAS exactos, ejecuta los E2E y reinicia GW, peer y CCAAS.
Todos los comandos usan un contexto explícito para no tocar otro clúster
configurado.

La ICA de Fabric, el orderer y el peer de referencia permanecen en Docker para
representar la red externa. El peer kind se une realmente a sus canales, crea
sus bases en CouchDB y endosa las operaciones del GW mediante sus propios
paquetes CCAAS. La ruta al peer Docker solo se usa para gossip/bootstrap y no
como endpoint de endoso del GW.

## Instalación de un host autorizado

```bash
helm upgrade --install <release> charts/gdc-host \
  --namespace <namespace> \
  --create-namespace \
  --values /secure/inventory/host.values.yaml \
  --atomic \
  --wait \
  --timeout 15m
```

Producción exige `networkMode=network`, peer propio, persistencia, URL HTTPS,
`authorization.existingSecret`, custodia KMS externa e imágenes inmutables.
Actualmente GW se limita a una réplica porque la cola asíncrona sigue siendo
local al proceso.

## CCAAS y package ID

Cada entrada `chaincodes[]` necesita imagen por digest, nombre, versión,
secuencia, canal, política y `packageId`. El package ID depende del paquete de
conexión y por tanto de la dirección exacta del Service del release. Cambiar el
nombre completo, el Service o el contrato TLS requiere regenerar el paquete.

Helm arranca el runtime CCAAS. La instalación del paquete en el peer, la
aprobación de organizaciones y el commit son operaciones auditadas del
reconciliador de la red.

Los nueve paquetes y sus IDs se generan de forma determinista para el Service
exacto del release:

```bash
HOST_FULLNAME=<fullname-helm> KUBE_NAMESPACE=<namespace> \
CCAAS_IMAGE=<registro>/host-runtime@sha256:<digest> \
CCAAS_OUTPUT_DIR=/secure/onboarding/ccaas \
  bash scripts/onboarding/prepare-ccaas-packages.sh
```

El fragmento `chaincodes.values.yaml` se combina con los values privados y el
`manifest.tsv` se entrega al reconciliador para instalación/aprobación.
