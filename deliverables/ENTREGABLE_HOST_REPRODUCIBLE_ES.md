# Entregable reproducible de un host del espacio de datos

Este repositorio público es el punto de entrada del entregable. Contiene el
GW CORE, los chaincodes necesarios, una red Hyperledger Fabric local de dos
hosts, el chart Helm del host y los flujos E2E. No requiere el repositorio
operativo privado de la red.

El llamado «runner SEDIA» no es Helm, ni una herramienta suministrada u
homologada por SEDIA. Es el nombre informal del recolector público
`scripts/collect-open-source-production-readiness-evidence.sh`, ejecutado por
`npm run evidence:open-source-production-readiness`. Su función es ejecutar
las pruebas y reunir estados, logs saneados, resumen y hashes para la memoria.

## Qué demuestra

La evidencia se divide en dos puertas complementarias:

1. **Docker/local-network**, prueba funcional canónica. Levanta una Root y una
   Issuer CA desechables, la Root CA y la ICA de Fabric, orderer, `Host1MSP`,
   `Host2MSP`, canales, chaincodes, GW CORE, PostgreSQL e IPFS. Ejecuta el alta
   del tenant, Consent, acceso SMART permitido y denegado, reinicio y
   recuperación persistente.
2. **Helm/Kubernetes**, prueba de portabilidad. Crea un clúster `kind` aislado,
   carga la misma imagen GW por digest, instala un peer con identidad exclusiva
   del `Host2MSP` recién admitido, CouchDB, GW CORE, PostgreSQL, IPFS y nueve runtimes CCAAS, y une
   el peer a los canales de la Fabric Docker `local-network`. Instala en ese
   peer los paquetes CCAAS exactos, actualiza la aprobación de `Host2MSP` y el
   GW repite los flujos E2E endosando exclusivamente mediante el peer kind.

`helm template` por sí solo no se considera una prueba de despliegue. Se
conserva como validación estática previa a la instalación real.

La secuencia objetivo de incorporación de un host autónomo es:

```text
Autorización del host
        ↓
HostingServiceCredential (VC JSON y VC-JWT)
        ↓
Registro gobernado en la ICA de Fabric
        ↓
Enrolamiento MSP y TLS con claves privadas generadas por el host
        ↓
Secrets de Kubernetes
        ↓
helm upgrade --install gdc-host
        ↓
Peer + CouchDB + GW CORE + PostgreSQL + IPFS + CCAAS
        ↓
Reconciliación de canales y chaincodes, escritura, lectura y reinicio
```

La evidencia encadena una Host VC verificada, el grant real de dos usos para el
peer, un grant independiente de un uso para el cliente GW, la emisión de
MSP/TLS y del certificado cliente vinculada al SHA-256 del identificador de esa
VC, la admisión dinámica por
el reconciliador, los Secrets, la instalación Helm,
el arranque del peer y CouchDB, la unión real del peer Kubernetes a los canales
externos, el lifecycle de los nueve CCAAS y el E2E del GW, que firma como
`Host2MSP`, contra ese mismo peer.
Docker mantiene la ICA de Fabric, el orderer y el peer de referencia que
representan la red externa; no endosa las operaciones del GW durante la puerta
Kubernetes. Tras reiniciar GW, peer y runtimes CCAAS se vuelven a comprobar
canales, lectura, autorización y persistencia PostgreSQL/IPFS.

## Autoridades que no deben confundirse

- La **CA del espacio de datos** publica el ancla y firma la Issuer CA.
- La **ICA del espacio de datos** verifica la autorización y emite la
  `HostingServiceCredential` como JSON VC y VC-JWT.
- La **ICA de Fabric** registra identidades de enrollment y firma los
  certificados MSP/TLS del peer y el certificado cliente independiente del GW.

La `HostingServiceCredential` autoriza el alta, pero no es un certificado de
Fabric. Después de verificarla, la autoridad registra un identificador y un
secreto de enrolamiento limitado a dos usos en la ICA de Fabric para MSP/TLS,
más otro identificador de un uso para el cliente GW. El helper
añade una ventana operativa de caducidad y rechaza el grant una vez vencida;
la autoridad revoca cualquier identificador no consumido porque Fabric CA no
aplica por sí sola esa fecha del fichero. El host ejecuta el enrollment y genera
localmente las claves privadas MSP/TLS y cliente GW; únicamente las CSR salen
del host y únicamente los certificados firmados regresan.

Para `local-network`, un dominio configurado previamente en la ICA del espacio
de datos puede obtener la credencial sin PDF. La petición sigue firmada por la
clave ES384 publicada en su `did:web`, y la evidencia registra el digest de esa
autorización sin inventar PDF, PAdES ni objeto IPFS. En producción se aplica la
política de evidencia aprobada para el participante.

## Requisitos

- Docker y Docker Compose
- Node.js 22 o posterior
- OpenSSL y `jq`
- Helm, `kubectl` y `kind`
- checkouts públicos adyacentes de `dataspace-ca-ts` y `dataspace-ica-ts`

No se necesita ningún path personal. Si los repositorios no son hermanos,
indique sus rutas con `DATASPACE_CA_ROOT` y `DATASPACE_ICA_ROOT`.

## Ejecución completa

```bash
cd "${REPO_ROOT}"
npm ci

release_tag="$(node -p "require('./package.json').version")-$(git rev-parse --short HEAD)"
image_name="gw-core:${release_tag}"

LOCAL_IMAGE_NAME="${image_name}" ./docker_build_local.sh

IMAGE_NAME="${image_name}" \
DATASPACE_CA_ROOT="${DATASPACE_CA_ROOT}" \
DATASPACE_ICA_ROOT="${DATASPACE_ICA_ROOT}" \
npm run evidence:open-source-production-readiness
```

La salida pública queda bajo
`artifacts/open-source-production-readiness/<fecha>/`. Incluye estados por
puerta, logs saneados, resumen y manifiesto con hashes. Las claves y secretos
desechables no entran en la evidencia pública.

## Pruebas separadas durante el desarrollo

```bash
# Docker: prueba funcional completa con PostgreSQL, IPFS y Fabric.
IMAGE_NAME="${image_name}" npm run docker:smoke:open-source-local-network

# Helm: lint, esquemas, perfiles e imágenes inmutables; no muta un clúster.
npm run helm:test:host

# Helm: instalación real; requiere la local-network Docker ya preparada.
IMAGE_NAME="${image_name}" npm run helm:smoke:local-network
```

El script Helm crea y elimina su propio clúster `kind` y usa en todos los
comandos el contexto `kind-gdc-host-evidence`. No usa el contexto Kubernetes
activo del operador.

## Promoción a test-network y producción

Se promueven la misma imagen inmutable y el mismo chart; cambian los values y
los secretos de cada entorno. Antes de instalar un host autónomo deben existir:

- decisión de gobernanza y `HostingServiceCredential` verificadas;
- grant de la ICA de Fabric limitado a dos enrolamientos para el peer y grant
  independiente de un uso para el cliente GW, ambos dentro de su ventana;
- MSP, TLS e identidad cliente GW generados localmente por el host;
- secretos Kubernetes para GW, peer, CouchDB, PostgreSQL y autorización;
- DNS, TLS, StorageClass, IngressClass y KMS del proveedor;
- imágenes CCAAS por digest y package IDs calculados para la dirección de
  servicio concreta del release;
- reconciliación aprobada de MSP, canales y lifecycle de chaincodes.

Helm no posee credenciales de registrar, no decide qué MSP entra en la red y no
modifica canales. Instala el runtime autorizado. La autoridad y el
reconciliador realizan las mutaciones privilegiadas antes y después de la
instalación, respectivamente.

| Entorno | Chart | Configuración específica |
| --- | --- | --- |
| `local-network` | `gdc-host` | Imágenes locales, autoridades locales, DNS `.localhost` y StorageClass de kind. |
| `test-network` | El mismo `gdc-host` | Digests publicados, autoridades de staging, DNS/TLS y almacenamiento cloud. |
| Producción | El mismo `gdc-host` | Host VC y certificados nuevos, digests aprobados, KMS y configuración del proveedor. |

No se reutilizan MSP, TLS, claves, Secrets, grants ni credenciales verificables
entre entornos. Se reutilizan el chart, la estructura de configuración y las
versiones o digests que hayan superado las puertas correspondientes.

## Archivos principales

- `infra/fabric/local-network/`: Fabric Docker reproducible.
- `charts/gdc-host/`: chart único para cualquier proveedor de host.
- `scripts/enrollment/`: autorización, registro y enrollment local.
- `scripts/governance/`: decisión y reconciliación declarativa.
- `scripts/onboarding/`: asistente por roles autoridad/host/plataforma.
- `scripts/collect-open-source-production-readiness-evidence.sh`: runner total.
- `scripts/smoke-helm-local-network.sh`: instalación y E2E Kubernetes.
- `deliverables/GUIA_OPERATIVA_HOST_ES.md`: procedimiento detallado por rol.
