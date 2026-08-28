# Fabric local-network reproducible

Esta carpeta contiene la red Docker pública usada por el entregable. Crea un
orderer y uno o dos peers independientes (`Host1MSP` y `Host2MSP`) y permite
desplegar los chaincodes incluidos en el repositorio.

La ruta recomendada usa material desechable generado por `dataspace-ca-ts`:

```bash
cd "${HOME}/GITS/gdc-workspace/gwtemplate-node-ts/infra/fabric/local-network"

ROOT_PASSPHRASE='<valor-local-desechable>' \
ISSUER_PASSPHRASE='<valor-local-desechable>' \
DATASPACE_CA_ROOT="${HOME}/GITS/gdc-workspace/dataspace-ca-ts" \
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
despliega chaincodes, ejecuta el GW con PostgreSQL/IPFS y añade la puerta Helm.
