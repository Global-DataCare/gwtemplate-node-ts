# Deploy Notes

Este documento resume el despliegue real que hay ahora mismo en este repo.
La idea es evitar la confusión entre `Cloud Run`, `GKE`, `.env.local-demo`,
`Firestore`, y los ficheros de despliegue.

## Regla rápida

- `Cloud Run` usa `cloud_deploy.sh` + `.env.deploy.<env>`
- `GKE` usa `cloud_deploy.sh gke <profile>` + `.env.gke.<profile>` + `demo-deploy.config`
- `.env.local-demo` es para local/demo, no para desplegar tal cual en GKE

## Qué archivo usa cada cosa

### Local

Para levantar la app en Docker/local:

- runtime principal: `.env.local-demo`
- comando típico:

```bash
./docker_build_local.sh
./docker_run_local.sh
```

Por defecto ese perfil usa:

- `DB_PROVIDER=mem`
- `STORAGE_PROVIDER=mem`
- flags demo como `SECURITY_MODE`, `NETWORK_MODE`, `DEMO_ALLOW_INSECURE_BEARER`

Es útil para probar rápido, pero no es el perfil de despliegue en Kubernetes.

### Cloud Run

Para desplegar en Cloud Run:

- runtime/deploy env: `.env.deploy.staging`, `.env.deploy.production`, etc.
- comando:

```bash
./cloud_deploy.sh staging
```

Ese camino es el de `*.run.app` / `*.a.run.app`.

Ejemplo típico de ese perfil:

- `DB_PROVIDER=firestore`
- `STORAGE_PROVIDER=gcs`
- `HOST_EXTERNAL_DOMAIN=<servicio-cloud-run>`

Importante:

- si `HOST_EXTERNAL_DOMAIN` apunta a `run.app`, ese perfil es para `Cloud Run`
- no reutilizar ese valor para `GKE`

### GKE

Para desplegar en GKE:

- runtime app env: `.env.gke.gdc`
- infra/cluster/ip/image: `demo-deploy.config`
- comando:

```bash
SKIP_BUILD=true ./cloud_deploy.sh gke gdc demo-deploy.config
```

Ese camino es el de Kubernetes y la IP pública, por ejemplo `34.175.78.233`.

## Diferencia entre `.env.gke.gdc` y `demo-deploy.config`

### `.env.gke.gdc`

Contiene la configuración interna de la aplicación:

- identidad del host
- providers (`firestore`, `gcs`, `mem`, etc.)
- provider de custodia raíz para `wrapped_keys`
- modo de seguridad
- flags demo
- URLs lógicas del host

Ejemplos:

- `HOST_ID_VALUE`
- `HOST_LEGAL_NAME`
- `DB_PROVIDER`
- `STORAGE_PROVIDER`
- `ENVELOPE_PROVIDER`
- `HOST_PUBLIC_URL`

Frontera de persistencia y Fabric:

- Los despliegues existentes mantienen `STORAGE_LAYOUT=legacy-v1`; no se
  renombran colecciones ni secciones de forma implicita.
- Los despliegues nuevos usan `STORAGE_LAYOUT=scoped-v2` junto con
  `DEPLOYMENT_ENV`, `NETWORK_MODE` y `HOST_STORAGE_SCOPE`.
- El prefijo fisico resultante sigue
  `<deployment>_<network-mode>_<host>_...`.
- `LEDGER_CHANNEL_GENESIS_SHA256` declara una huella SHA-256 del bloque cero
  por canal. El GW consulta el peer y falla cerrado si alguna no coincide.
- Dos canales con el mismo nombre en test y produccion no son el mismo ledger;
  la vinculacion se demuestra mediante su bloque genesis.

Regla de custodia:

- `ENVELOPE_PROVIDER=memory` solo para dev/test
- `ENVELOPE_PROVIDER=local` usa `KEK_SECRET` y es compat/local
- `ENVELOPE_PROVIDER=gcp-kms` es el objetivo productivo en GCP
- `ENVELOPE_PROVIDER=hashicorp-transit` es la opción portable/open source

No uses solo la palabra `vault` para este tema en docs operativos, porque GW ya
usa `vault` para almacenamiento confidencial y el provider externo de custodia
raíz puede ser `HashiCorp Transit`.

### `demo-deploy.config`

Contiene el destino del despliegue GKE:

- proyecto GCP
- región
- clúster
- namespace
- IP pública
- nombre de la IP reservada
- tag y ruta final de la imagen

Ejemplos:

- `GCP_PROJECT_ID`
- `GKE_CLUSTER`
- `K8S_NAMESPACE_GDC`
- `GDC_PUBLIC_IP`
- `GDC_STATIC_IP_NAME`
- `GDC_IMAGE_TAG`

## Caso más simple: desplegar la imagen local ya construida en GKE

Si ya has generado la imagen local con:

```bash
./docker_build_local.sh
```

entonces el despliegue real a GKE es:

```bash
SKIP_BUILD=true ./cloud_deploy.sh gke gdc demo-deploy.config
```

Qué hace exactamente:

1. Carga `.env.gke.gdc`
2. Carga `demo-deploy.config`
3. Busca la imagen local `gwtemplate`
4. La reetiqueta con `GDC_IMAGE`
5. La sube a Artifact Registry
6. Aplica los manifiestos en GKE

## Cómo funciona la tag

La imagen local puede existir simplemente como:

```bash
gwtemplate:latest
```

Eso no es problema.

Con `SKIP_BUILD=true`, el script:

- toma `LOCAL_IMAGE_NAME=gwtemplate`
- la reetiqueta con la tag definida en `demo-deploy.config`
- publica esa tag en el registry

Ahora mismo la tag se controla en:

- `demo-deploy.config`

por ejemplo:

```bash
export GDC_IMAGE_TAG="1.14.0-0535453"
```

## Qué fichero tocar según lo que quieras cambiar

### Quiero cambiar la identidad del host

Edita:

- `.env.gke.gdc`

Variables típicas:

- `HOST_ID_VALUE`
- `HOST_LEGAL_NAME`
- `HOST_JURISDICTION`
- `HOST_ADMIN_EMAIL`

### Quiero cambiar la IP o el clúster

Edita:

- `demo-deploy.config`

Variables típicas:

- `GKE_CLUSTER`
- `K8S_NAMESPACE_GDC`
- `GDC_PUBLIC_IP`
- `GDC_STATIC_IP_NAME`

### Quiero cambiar la tag publicada

Edita:

- `demo-deploy.config`

Variable:

- `GDC_IMAGE_TAG`

## Cloud Run vs GKE

### Cloud Run

- usa `run.app` / `a.run.app`
- se despliega con `.env.deploy.*`
- no es el sitio donde corre el `peer` de Fabric

### GKE

- usa clúster Kubernetes
- se despliega con `.env.gke.*` + `demo-deploy.config`
- es el camino que encaja con `fabric-multicloud`
- es donde tiene sentido convivir con peer/orderer/CA de Fabric

## Riesgo principal a recordar

No mezclar la identidad y URL pública de `Cloud Run` con la de `GKE`.

En la práctica:

- no usar `HOST_EXTERNAL_DOMAIN=<run.app>` dentro del perfil de GKE
- si GKE debe ser una identidad distinta, cambiar `HOST_ID_VALUE`

## Comandos que importan

### Local build

```bash
./docker_build_local.sh
```

### GKE usando imagen local

```bash
SKIP_BUILD=true ./cloud_deploy.sh gke gdc demo-deploy.config
```

### Cloud Run staging

```bash
./cloud_deploy.sh staging
```
