# E9: políticas e identidad de GW CORE 1.26.0

Esta ampliación conserva las evidencias históricas y añade una ejecución
específica de la pasarela. No modifica su comportamiento ni genera otra imagen.

## Resultado

- Código fuente 1.26.0: 90 casos de autorización/transporte y 10 de identidad con
  firmas y HTTP reales, todos superados y sin omisiones.
- Imagen pública por digest: ocho recorridos con Fabric real, cinco permitidos
  y tres denegados. El resumen clínico y la búsqueda individual son recorridos
  distintos en esta versión.
- Verificador del expediente: 15 contratos de integridad y recuento, separados
  de las pruebas funcionales.
- Batería general adicional: 1.181 superados, cero fallidos y tres omisiones
  preexistentes identificadas en `full-suite-diagnostic.json`. No se suman
  resultados de ejecuciones repetidas.

## Repetir la batería de código

Usar Node.js 26.13.0 y el código de release
`01f36c02877fb2da7a55538320ab69d0dc2e84b9` con los ficheros de prueba y
verificación de esta ampliación. Instalar con `npm ci`; no cambiar el lockfile.

`manifest.json` conserva los dos comandos Jest y su lista exacta de ficheros.
`${GW_ROOT}` representa la raíz del checkout y `${EVIDENCE_DIR}` la carpeta de
salida del operador. Las rutas personales de los logs se normalizan con esos
marcadores. Los dos conjuntos son disjuntos: 90 más 10 casos.

```bash
node --test scripts/tests/e9-gw-policy-evidence.test.mjs
node scripts/verify-e9-gw-policy-evidence.mjs deliverables/e9-testing/20261115-gw-core-1260-policy/manifest.json
```

El servidor HTTP de la nueva prueba de identidad utiliza un puerto asignado por
el sistema, claves de fixture canónicas y firmas ES384 reales. Se cierra al
finalizar. No se utiliza una cuenta personal o una identidad de producción.

## Repetir la capa de imagen y Fabric

El artefacto probado es exclusivamente el digest de `gateway.image` del
manifiesto. `fabric-commands.json` conserva la secuencia de preparación de CA
desechable, red, contratos, entorno de GW y ejecución del smoke canónico
`scripts/smoke-docker-local-network.sh`.

Para una repetición hay que reservar un bloque libre de puertos, un nombre
exclusivo de proyecto Compose y red, prefijos exclusivos de contenedores y del
peer (`CORE_PEER_ID`), y el nombre exclusivo del servicio de consentimientos.
Los valores utilizados están en `fabric-preflight.json`. No se deben reutilizar
ni retirar contenedores de otra ejecución. No usar el reset global del
bootstrap sobre un Docker compartido.

La preparación usa los scripts individuales de
`infra/fabric/local-network/scripts/`, la CLI `dataspace-ca-ts`,
`scripts/prepare-consentaccess-local-fabric-env.sh` y
`chaincode/scripts/consentaccess-local-devnet.sh`. Tras preparar la red, el
smoke recibe `SKIP_FABRIC_PREP=true`, `PERSISTENCE_PROFILE=mem` y los nombres
aislados correspondientes. No se contacta con redes cloud.

`fabric-10-published-image-policy.log` contiene los registros originales del
recorrido, con rutas personales y tokens desechables redactados. Su resumen
`verifiedFlows` debe contener ocho elementos únicos, tres terminados en
`-deny`. El log debe terminar identificando el digest probado.

`fabric-11-runtime-version.log` confirma la versión dentro del contenedor.
`fabric-cleanup.json` registra la retirada de 35 contenedores propios, cero
contenedores propios restantes y cero contenedores preexistentes eliminados.

## Límites de la evidencia

La retirada de una clave del conjunto del emisor no es la revocación de una
credencial de negocio. No se atribuye a esta ejecución una prueba completa de
propagación de revocación, de verificación externa GXDCH/Clearing House, de un
portal autenticado o de producción. La capa de imagen utiliza el perfil
demo/local-network canónico y Fabric real; las pruebas de firma real se
identifican por separado.

Los originales completos quedan en custodia privada del operador. Los hashes
del manifiesto corresponden exactamente a los ficheros compartibles de esta
carpeta. Los registros de red y datos privados de servicios desplegados no
forman parte de este expediente.
