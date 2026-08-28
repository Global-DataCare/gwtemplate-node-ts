# Entregable reproducible de un host del espacio de datos

Este repositorio público es el punto de entrada del entregable. Contiene el
GW CORE, los chaincodes necesarios, una red Hyperledger Fabric local de dos
hosts, el chart Helm del host y los flujos E2E. No requiere el repositorio
operativo privado de la red.

## Qué demuestra

La evidencia se divide en dos puertas complementarias:

1. **Docker/local-network**, prueba funcional canónica. Levanta una Root y una
   Issuer CA desechables, la Root CA y la ICA de Fabric, orderer, `Host1MSP`,
   `Host2MSP`, canales, chaincodes, GW CORE, PostgreSQL e IPFS. Ejecuta el alta
   del tenant, Consent, acceso SMART permitido y denegado, reinicio y
   recuperación persistente.
2. **Helm/Kubernetes**, prueba de portabilidad. Crea un clúster `kind` aislado,
   carga la misma imagen GW por digest, instala GW CORE, PostgreSQL e IPFS con
   el chart y repite los flujos E2E contra la Fabric `local-network`. El
   contrato estático del chart también renderiza peer, CouchDB y CCAAS para un
   host autónomo.

`helm template` por sí solo no se considera una prueba de despliegue. Se
conserva como validación estática previa a la instalación real.

## Autoridades que no deben confundirse

- La **CA del espacio de datos** publica el ancla y firma la Issuer CA.
- La **ICA del espacio de datos** verifica la autorización y emite la
  `HostingServiceCredential` como JSON VC y VC-JWT.
- La **ICA de Fabric** registra la identidad de enrollment y firma los
  certificados MSP y TLS del peer.

La `HostingServiceCredential` autoriza el alta, pero no es un certificado de
Fabric. Después de verificarla, la autoridad registra un identificador y un
secreto temporal en la ICA de Fabric. El host ejecuta el enrollment y genera
localmente sus claves privadas MSP/TLS; únicamente la CSR sale del host y
únicamente los certificados firmados regresan.

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
cd "${HOME}/GITS/gdc-workspace/gwtemplate-node-ts"
npm ci

release_tag="$(node -p "require('./package.json').version")-$(git rev-parse --short HEAD)"
image_name="gw-core:${release_tag}"

LOCAL_IMAGE_NAME="${image_name}" ./docker_build_local.sh

IMAGE_NAME="${image_name}" \
DATASPACE_CA_ROOT="${HOME}/GITS/gdc-workspace/dataspace-ca-ts" \
DATASPACE_ICA_ROOT="${HOME}/GITS/gdc-workspace/dataspace-ica-ts" \
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
- grant temporal de la ICA de Fabric;
- MSP y TLS generados localmente por el host;
- secretos Kubernetes para GW, peer, CouchDB, PostgreSQL y autorización;
- DNS, TLS, StorageClass, IngressClass y KMS del proveedor;
- imágenes CCAAS por digest y package IDs calculados para la dirección de
  servicio concreta del release;
- reconciliación aprobada de MSP, canales y lifecycle de chaincodes.

Helm no posee credenciales de registrar, no decide qué MSP entra en la red y no
modifica canales. Instala el runtime autorizado. La autoridad y el
reconciliador realizan las mutaciones privilegiadas antes y después de la
instalación, respectivamente.

## Archivos principales

- `infra/fabric/local-network/`: Fabric Docker reproducible.
- `charts/gdc-host/`: chart único para cualquier proveedor de host.
- `scripts/enrollment/`: autorización, registro y enrollment local.
- `scripts/governance/`: decisión y reconciliación declarativa.
- `scripts/onboarding/`: asistente por roles autoridad/host/plataforma.
- `scripts/collect-open-source-production-readiness-evidence.sh`: runner total.
- `scripts/smoke-helm-local-network.sh`: instalación y E2E Kubernetes.
