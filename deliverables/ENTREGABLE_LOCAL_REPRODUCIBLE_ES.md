# Entregable local reproducible

## Para qué sirve

Este recorrido permite a un auditor demostrar el funcionamiento del software
sin acceder a una nube, a datos reales ni a secretos de producción. No es una
migración ni un despliegue productivo.

Demuestra con datos sintéticos:

1. ICA del espacio de datos y emisión de una Host VC;
2. Root CA e ICA de Fabric desechables;
3. admisión de `Host2MSP` en una red inicialmente formada por `Host1MSP`;
4. instalación mediante el chart `gdc-host` en kind;
5. peer, CouchDB, GW CORE, PostgreSQL, IPFS y nueve CCAAS;
6. escritura, lectura, denegación y persistencia después de reiniciar.

## Ejecución

```bash
git clone https://github.com/Global-DataCare/gwtemplate-node-ts.git
git clone https://github.com/Global-DataCare/dataspace-ca-ts.git
git clone https://github.com/Global-DataCare/dataspace-ica-ts.git

cd gwtemplate-node-ts
npm ci

export DATASPACE_CA_ROOT="$(cd ../dataspace-ca-ts && pwd)"
export DATASPACE_ICA_ROOT="$(cd ../dataspace-ica-ts && pwd)"
export IMAGE_NAME="gw-core:local-evidence-$(git rev-parse --short HEAD)"

LOCAL_IMAGE_NAME="${IMAGE_NAME}" ./docker_build_local.sh
npm run evidence:open-source-production-readiness
```

El resultado válido contiene `PASS` en todas las puertas y un manifiesto de
hashes bajo `artifacts/open-source-production-readiness/`.

## Qué no demuestra

- No migra datos reales.
- No despliega una ICA ni un host externos.
- No reutiliza VC, MSP, TLS, grants, Secrets ni claves entre entornos.
- No sustituye la aceptación de `test-network` ni producción.

La explicación extensa del alcance está en
[`ENTREGABLE_HOST_REPRODUCIBLE_ES.md`](./ENTREGABLE_HOST_REPRODUCIBLE_ES.md).
