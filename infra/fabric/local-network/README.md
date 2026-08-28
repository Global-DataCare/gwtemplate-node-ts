# Fabric local-network reproducible

Esta carpeta contiene la red Docker pública usada por el entregable. Crea un
orderer y uno o dos peers independientes (`Host1MSP` y `Host2MSP`) y permite
desplegar los chaincodes incluidos en el repositorio.

La ruta recomendada usa material desechable generado por `dataspace-ca-ts`:

```bash
cd "${REPO_ROOT}/infra/fabric/local-network"

ROOT_PASSPHRASE='<valor-local-desechable>' \
ISSUER_PASSPHRASE='<valor-local-desechable>' \
DATASPACE_CA_ROOT="${DATASPACE_CA_ROOT}" \
SINGLE_HOST=false \
./scripts/00-bootstrap-from-dataspace-ca.sh
```

El flujo realiza:

1. bootstrap de la Root CA y la Issuer CA del espacio de datos;
2. arranque de Root CA e ICA de Fabric;
3. registro y enrollment de orderer, administradores y peers en la ICA de
   Fabric;
4. generación local de claves MSP/TLS;
5. creación de `identity-local` y `health-care-local`;
6. unión de los peers autorizados.

Los certificados de los peers deben verificar contra la Root usando la ICA de
Fabric como intermedia. Las claves privadas permanecen bajo
`organizations/` y nunca forman parte de la evidencia pública.

La puerta de auditoría prueba además la admisión dinámica. Arranca los canales
solo con `Host1MSP`, genera las identidades MSP/TLS del peer y la identidad
cliente GW de `Host2MSP`, todas vinculadas a la Host VC, firma con el
administrador gobernador una actualización de configuración, la aplica y solo
entonces arranca y une el segundo peer:

```bash
node "${REPO_ROOT}/scripts/onboarding/create-local-audit-authorization.mjs" \
  --output /tmp/host2-authorization.json \
  --bundle-dir /tmp/host2-governance
SINGLE_HOST=true HLF_BOOTSTRAP_CHANNELS=identity-local,health-care-local \
  ./scripts/02-bootstrap-network.sh
HOST_AUTHORIZATION_JSON=/tmp/host2-authorization.json \
SINGLE_HOST=true HLF_BOOTSTRAP_CHANNELS=identity-local,health-care-local \
  ./scripts/06-admit-host2.sh
```

`06-admit-host2.sh` contiene secretos únicamente desechables de local-network.
En redes externas, la misma mutación se ejecuta mediante el reconciliador y su
inventario privado; el host no puede admitirse a sí mismo.

Para desplegar los chaincodes de identidad incluidos en GW CORE:

```bash
SINGLE_HOST=false ./scripts/05-deploy-identity-chaincodes.sh
```

Para desplegar uno concreto:

```bash
CHANNEL_NAME=identity-local \
CHAINCODE_NAME=organization-sc \
CHAINCODE_PATH="$(git rev-parse --show-toplevel)/chaincode/organization-sc-javascript" \
./scripts/03-deploy-chaincode.sh
```

La prueba canónica no se ejecuta manualmente desde esta carpeta. Desde la raíz
del repositorio use:

```bash
npm run evidence:open-source-production-readiness
```

Ese runner reinicia únicamente el devnet identificado, prueba ambos MSP,
despliega chaincodes, ejecuta el GW como `Host2MSP` con PostgreSQL/IPFS y añade
la puerta Helm.
