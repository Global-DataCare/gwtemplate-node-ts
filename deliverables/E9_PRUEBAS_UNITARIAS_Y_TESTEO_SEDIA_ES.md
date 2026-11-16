# Entregable E9: pruebas unitarias y testeo

## 1. Objeto y entorno de ejecución

El Entregable E9 documenta las pruebas de los paquetes de utilidades, los SDK, el servicio de certificación ICA y su cliente, y los controles de identidad, autorización y acceso de la pasarela. La validación comprende pruebas unitarias, comprobaciones de integración y recorridos completos entre las aplicaciones, el gateway y la ICA.

| Parámetro | Valor |
|---|---|
| Fecha de ejecución | 11 de noviembre de 2026 |
| Sistema | macOS |
| Node.js | `v26.13.0` |
| npm | `11.20.0` |
| Entorno de pruebas | Local, con perfiles test/demo |
| Integración | Procesos reales de GW e ICA mediante HTTP |
| Ampliación específica de la pasarela | 15 de noviembre de 2026; GW CORE 1.26.0; apartado 10 |
| Refuerzo de la verificación de identidad y acceso | 16 de noviembre de 2026; GW CORE 1.26.1; apartado 11 |

La ejecución inicial del 11 de noviembre finaliza con todas sus baterías superadas y cero casos fallidos, omitidos, cancelados o pendientes. Los resultados posteriores se detallan por versión en los apartados 10 y 11.

## 2. Componentes y versiones evaluadas

| Repositorio | Versión de código | Commit probado |
|---|---:|---|
| gdc-common-utils-ts | 2.9.30 | [`7f2caba88bd5`](https://github.com/Global-DataCare/gdc-common-utils-ts/commit/7f2caba88bd5ac8cc0e9a1fd90efce76110ea551) |
| gdc-sdk-core-ts | 2.9.12 | [`e795e5b74f11`](https://github.com/Global-DataCare/gdc-sdk-core-ts/commit/e795e5b74f11e8e8c100b76fef4fed5ab39b8f2d) |
| gdc-sdk-front-ts | 2.9.0 | [`7fe121d21490`](https://github.com/Global-DataCare/gdc-sdk-front-ts/commit/7fe121d21490be5d8cd882cfcac6bc4435868863) |
| gdc-sdk-node-ts | 2.9.34 | [`4b726b5cac45`](https://github.com/Global-DataCare/gdc-sdk-node-ts/commit/4b726b5cac458fcc94b543fbde6aeb649aaf80c6) |
| dataspace-ica-ts | 1.3.4 | [`67333c8e4ee9`](https://github.com/Global-DataCare/dataspace-ica-ts/commit/67333c8e4ee9177f5e7b0379f8193dd60930cd6b) |
| ica-client-sdk-ts | 2.0.15 | [`fdf97b553bfa`](https://github.com/Global-DataCare/ica-client-sdk-ts/commit/fdf97b553bfa4c130d8648c2a521abe8a8781e60) |
| gwtemplate-node-ts | 1.25.33 | [`ea8abae0f8c1`](https://github.com/Global-DataCare/gwtemplate-node-ts/commit/ea8abae0f8c13e817d9241881f169e9400833d9a) |
| gwtemplate-node-ts, ampliación de políticas | 1.26.0 | [`01f36c02877f`](https://github.com/Global-DataCare/gwtemplate-node-ts/commit/01f36c02877fb2da7a55538320ab69d0dc2e84b9) |
| gwtemplate-node-ts, refuerzo de identidad y acceso | 1.26.1 | [`d2fba2f7561f`](https://github.com/Global-DataCare/gwtemplate-node-ts/commit/d2fba2f7561f2a59a3881bbd75a3f2b3549279cf) |

Cada componente se instala con `npm ci` a partir de su archivo de dependencias fijadas. Los registros de `npm ls` identifican las versiones cargadas durante la ejecución. Los commits de la tabla permiten localizar el código empleado en cada batería.

## 3. Resultados de las pruebas

| Batería | Casos superados | Organización de las pruebas |
|---|---:|---|
| Utilidades comunes | 935/935 | 217 suites |
| SDK Core | 134/134 | Contratos y utilidades compartidas del SDK |
| SDK Front | 69/69 | Sesiones, descubrimiento y adaptación para aplicaciones |
| SDK Node, pruebas unitarias e interacciones | 345/345 | 66 ficheros |
| SDK Node, integración con servicios reales | 10/10 | 6 ficheros E2E |
| ICA, batería API completa | 309/309 | Verificación, credenciales y operaciones de identidad |
| Cliente ICA, baterías aisladas | 52/52 | 2 ficheros |
| Cliente ICA, integración HTTP | 2/2 | Verificación y creación del documento DID |
| Comprobación de runtime e integridad E9 | 13/13 | Requisitos de ejecución y validación del expediente |
| GW CORE 1.26.0, autorización y controles de transporte | 90/90 | 7 ficheros; dependencias aisladas y servicios en memoria según cada prueba |
| GW CORE 1.26.0, verificación criptográfica de identidad | 10/10 | Servidor HTTP local de descubrimiento y claves; firmas ES384 reales |
| GW CORE 1.26.0, imagen publicada con Fabric local | 8/8 | Cinco recorridos autorizados y tres denegados |
| GW CORE 1.26.1, cobertura específica de identidad y Clearing House | 114/114 | 20 ficheros; entorno local; detalle en el apartado 11 |
| GW CORE 1.26.1, recorridos del SDK con gateway e ICA | 6/6 | Perfil local de demostración explícito; detalle en el apartado 11 |

Todas las baterías registran cero fallidos, omitidos, cancelados y pendientes. El cliente ICA ejecuta también una comprobación de descubrimiento que verifica la inclusión de los dos ficheros de pruebas aisladas.

## 4. Cobertura de código

La batería de utilidades comunes recoge la cobertura por fichero y el siguiente agregado:

| Métrica | Cobertura |
|---|---:|
| Sentencias | 86,17 % |
| Ramas | 65,89 % |
| Funciones | 78,09 % |
| Líneas | 87,68 % |

El log `common-coverage.log` contiene los 935 resultados y la tabla de cobertura completa.

## 5. Recorridos de integración

El inventario de SDK Node comprende 72 ficheros: 66 de pruebas unitarias e interacciones y 6 de integración con servicios reales. La ejecución de estos últimos abarca diez recorridos:

1. Ciclo de vida del profesional en GW.
2. Ingesta de comunicaciones mediante DIDComm/plain y sus proyecciones clínicas.
3. Ingesta mediante el formato FHIR de compatibilidad y sus proyecciones clínicas.
4. Flujo integrado del perfil de controlador individual.
5. Ciclo de vida individual, con operaciones de desactivación y purga.
6. Diálogo de solicitud y concesión de consentimiento entre controlador y profesional.
7. Ciclo completo de la capa de backend para aplicaciones (BFF).
8. Ciclo de vida del controlador de organización.
9. Perfil individual independiente.
10. Perfil profesional independiente.

El ciclo BFF comprende verificación de la organización, confirmación de Order, registro dinámico de clientes (DCR) cifrado, desbloqueo del perfil, consentimiento, obtención de autorización SMART y operaciones clínicas con comprobaciones de autoría.

El ciclo del controlador de organización verifica la reemisión de credenciales, la activación y registro de su dispositivo, la desactivación del tenant y su purga. Los perfiles independientes utilizan un tenant y un consentimiento preparados mediante las operaciones del SDK y del servicio.

La integración del cliente ICA ejecuta dos casos mediante HTTP: la vinculación del representante con su clave y la creación del documento DID de la organización con las claves aportadas por el llamante. El proceso ICA utiliza la clave de firma de prueba incluida en el repositorio.

## 6. Contratos funcionales comprobados

Las baterías verifican los siguientes contratos:

- Descubrimiento y ejecución de las pruebas del cliente ICA y de vinculación del controlador.
- Generación de credenciales con fechas de firma independientes para organización y persona.
- Identificación diferenciada de la organización acreditada y del verificador que firma el PDF.
- Asociación del controlador con su clave pública y registro del dispositivo mediante DCR.
- Aplicación del consentimiento y de la autorización SMART al acceso clínico solicitado.
- Atribución de las escrituras clínicas al profesional autorizado.
- Validación de los resultados internos de las respuestas Bundle de las operaciones asíncronas.
- Desactivación y purga de las entidades previstas en los recorridos de ciclo de vida.
- Uso de Node.js 26.13.0 en el lanzador de integración.
- Comprobación de integridad de los logs y de correspondencia entre resultados y manifiestos.

Las pruebas de PDF emplean documentos firmados y un anexo estructurado. Sus huellas SHA-256 identifican las entradas utilizadas en las comprobaciones de firma, extracción de identidad y vinculación de credenciales.

## 7. Evidencia y trazabilidad

El expediente reúne los siguientes archivos:

| Archivo o carpeta | Contenido |
|---|---|
| `manifest.json` | Componentes, versiones, commits, comandos, fechas y resultados |
| `logs/` | Salidas completas de las baterías de aceptación |
| `provenance/` | Registros estructurados de cada ejecución |
| `checks/` | Instalaciones, dependencias y comprobaciones complementarias |
| `node-file-inventory.json` | Inventario de los 72 ficheros de SDK Node |
| `SHA256SUMS.txt` | Huellas de los archivos del expediente |
| `REPRODUCIR.md` | Procedimiento y requisitos para repetir las pruebas |

Los registros vinculan cada resultado con el código ejecutado, su comando, la versión de Node.js y npm, las fechas de inicio y fin y el código de salida del proceso. Las rutas locales y los datos privados se representan mediante marcadores o huellas. Los finales de línea de consola se normalizan a LF.

## 8. Comprobación automática

Desde el checkout de GW Core:

```bash
node --version
npm run verify:e9 -- deliverables/e9-testing/20261111T121038Z/manifest.json
```

El verificador comprueba las trece baterías del expediente, la versión de Node.js, los commits, los comandos ejecutados y sus códigos de salida. Contrasta los contadores con los resúmenes de los logs y calcula sus huellas SHA-256.

La integridad del conjunto de archivos se comprueba desde el directorio del expediente:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

## 9. Acceso al expediente

El [expediente consolidado de pruebas E9](https://github.com/Global-DataCare/gwtemplate-node-ts/tree/main/deliverables/e9-testing/20261111T121038Z) contiene la matriz superada, sus logs, manifiestos e instrucciones de reproducción.

Los siete repositorios incluyen la evidencia correspondiente en `deliverables/e9-testing/20261111T121038Z`.

## 10. Ampliación: políticas de uso y pruebas negativas de GW CORE 1.26.0

La pasarela se incluye expresamente con una ejecución nueva, vinculada al código
de la versión **1.26.0**, commit `01f36c02877fb2da7a55538320ab69d0dc2e84b9`,
y Node.js **26.13.0**. Los resultados del 11 de noviembre y sus versiones
permanecen intactos. El expediente de esta ampliación está en
[`e9-testing/20261115-gw-core-1260-policy`](e9-testing/20261115-gw-core-1260-policy).

### 10.1 Identidad y autorización: 100 casos superados

Se ejecutaron dos baterías sin casos fallidos, omitidos o pendientes:

| Batería | Resultado | Qué comprueba |
| --- | --- | --- |
| Autorización, transporte y reglas de acceso | 90/90 | Consentimientos, roles, identidad del solicitante, contrato entre organizaciones, alcance SMART y restricciones de emergencia |
| Identidad con firmas reales y claves obtenidas por HTTP | 10/10 | Un caso válido y nueve rechazos de identidad o configuración de confianza no válidas |

Entre los casos identificados en la matriz hay **14 negativos de identidad** y
**13 negativos de autorización o política**. Nueve de los negativos de identidad
realizan verificación criptográfica real, sin sustituir el verificador ni las
peticiones HTTP por mocks. Las otras pruebas indican sus dependencias aisladas
en el código; no se presentan como un recorrido completo de un proveedor externo.

Los nueve casos criptográficos rechazan:

1. El contenido de un token modificado después de firmarlo.
2. Una identidad firmada cuyo periodo de validez ha terminado.
3. Una identidad que todavía no ha entrado en vigor.
4. Un token dirigido a otro destinatario.
5. Un token cuyo emisor no coincide con el esperado.
6. Una firma cuya clave no figura en el conjunto publicado al comenzar la verificación.
7. Un documento de descubrimiento que declara otro emisor.
8. Un emisor fuera de los proveedores expresamente admitidos.
9. Un token mal formado.

Las pruebas de política incluyen el rechazo por ausencia de consentimiento,
consentimiento vencido o mal formado, denegación expresa prevalente, rol o correo
no admitido, empleado sin vinculación activa, ausencia del contrato entre
organizaciones y alcance de acceso no permitido. Una identidad válida sin
permiso se diferencia de una identidad no válida.

### 10.2 Imagen publicada y políticas con Fabric real: ocho recorridos

Se ejecutó la imagen pública inmutable
`ghcr.io/global-datacare/gw-core@sha256:a19ba9f712642da6a715e0039352204fc21d7546a6dfcd86cd8f17f26158c2f8`.
El proceso confirmó versión **1.26.0** y Node.js **26.13.0**. Se utilizaron
un orderer, un peer y contratos reales de Fabric en una red local aislada,
con los perfiles y datos sintéticos canónicos del repositorio.

| Recorrido | Resultado esperado y observado |
| --- | --- |
| Consentimiento individual y resumen clínico limitado a las secciones autorizadas | Acceso permitido y resumen leído |
| Consentimiento individual y búsqueda de datos | Acceso permitido y búsqueda completada |
| Profesional de secretaría médica con consentimiento | Acceso permitido y búsqueda completada |
| Profesional de secretaría médica sin consentimiento | Solicitud de token denegada |
| Investigación con contrato, consentimiento y rol admitido | Acceso permitido y búsqueda de gemelos completada |
| Investigación con rol no admitido | Solicitud de token denegada |
| Investigación con permiso dirigido al correo del solicitante | Acceso permitido y búsqueda de gemelos completada |
| Investigación con permiso dirigido a otro correo | Solicitud de token denegada |

Las reglas de consentimiento se registraron y releyeron en Fabric. Se comprobó
también la repetición de lotes y sus identificadores, sin contar cada activo o
petición HTTP como otro caso. El canal de investigación terminó con altura 5.
El log conserva los ocho identificadores de recorrido y el digest probado.

Estos recorridos prueban el comportamiento de la imagen publicada con Fabric
local. El perfil utiliza las fixtures de verificación del repositorio; no
acredita una instancia externa de Clearing House ni un recorrido autenticado
del portal GDC. Los contenedores, volúmenes y la red creados para la ejecución
se retiraron al terminar, conservando los recursos preexistentes.

### 10.3 Recuento y trazabilidad

Los 90 y 10 casos pertenecen a conjuntos distintos y suman **100**. Los 15 casos
del nuevo verificador del expediente comprueban integridad y contabilización;
no se suman como pruebas de políticas de la pasarela. Los 13 controles del
expediente histórico tampoco se reclasifican como pruebas de políticas.
Los ocho recorridos de la imagen se informan como una capa E2E separada; no se
mezclan con los casos Jest para producir un total único.

Como diagnóstico adicional se ejecutó la batería general del repositorio:
**1.181 superados, cero fallidos y tres omitidos**, sobre 1.184 casos. Las tres
omisiones preexistentes corresponden a un recorrido Firestore, validación XSD
de factura UBL y conexión a una ICA externa. Se identifican por nombre en
`full-suite-diagnostic.json`; no se cuentan como aprobadas. Esta ejecución
repite casos de la ampliación y no se añade a su total de 100.

El manifiesto enlaza cada caso con el fichero y resultado de ejecución, conserva
los comandos y las huellas de los logs y fija el digest de la imagen publicada.
El verificador rechaza otra versión o imagen, resultados inventados, logs
modificados, procesos fallidos, omisiones y duplicación de casos:

```bash
node scripts/verify-e9-gw-policy-evidence.mjs deliverables/e9-testing/20261115-gw-core-1260-policy/manifest.json
```

La retirada de una clave de firma no equivale a revocar una credencial de negocio.
Esta ampliación no atribuye a esos casos una prueba completa de propagación de
revocación de credencial y posterior denegación de acceso.

## 11. Refuerzo de las pruebas de identidad y acceso: GW CORE 1.26.1

La versión 1.26.1 refuerza la cobertura de pruebas del Clearing House de cada organización, las credenciales emitidas por la ICA y la validación de resultados Gaia-X. Las verificaciones comprueban la identidad y los permisos de quien solicita datos, el estado vigente de las autorizaciones y la correspondencia entre cada petición y su respuesta firmada. Los resultados de la versión 1.26.0 recogidos en el apartado 10 conservan su ejecución, imagen y cifras originales.

### 11.1 Identidad y autorización en cada intercambio

La ICA acredita a las organizaciones. Para acceder a los datos de un individuo se verifica también la identidad de la persona o del sistema solicitante y su autorización concreta. Las comprobaciones incluyen profesionales, el controlador del individuo y familiares o cuidadores autorizados, con sus respectivas identidades y permisos.

El servicio de índice comprueba la autorización y firma el token SMART on FHIR. Cuando los datos están en otro sistema de historia clínica, este solicita la verificación al Clearing House de su propia organización. La comprobación vincula la firma, el solicitante, el individuo, los datos solicitados y el estado vigente de las autorizaciones.

### 11.2 Ejecuciones y resultados

| Ejecución | Resultado | Entorno y alcance |
| --- | --- | --- |
| Cobertura específica en veinte ficheros de pruebas de identidad, Clearing House, ICA y adaptador Gaia-X | 114 superados; 0 fallidos; 0 omitidos | Pruebas unitarias y de integración locales, con firmas criptográficas y servicios HTTP controlados según el caso |
| Batería general de GW CORE 1.26.1 | 1.315 superados; 0 fallidos; 3 omisiones preexistentes | Incluye los 114 casos de la fila anterior; no constituye un total adicional |
| Recorridos del SDK con Gateway Core y una ICA local | 6 superados; 0 fallidos; 0 omitidos | Perfil de demostración local explícito, almacenamiento en memoria y contenedor aislado; Node.js 26.13.0 |
| Contratos de repositorio, configuración y versión del runtime | 14 superados; 0 fallidos; 0 omitidos | Comprobaciones adicionales de integridad técnica; se contabilizan separadamente de las pruebas funcionales |

Las tres omisiones de la batería general corresponden a un recorrido Firestore, la validación XSD de factura UBL y la conexión a una ICA externa. El inventario identifica cada fichero y su resultado.

Las comprobaciones específicas cubren:

- Firmas válidas y rechazo de firmas o contenidos alterados.
- Correspondencia del emisor, destinatario, claves de confianza y presentación con la solicitud.
- Autenticación de los clientes registrados y rechazo de peticiones repetidas.
- Vinculación vigente de profesionales y miembros autorizados con su organización o individuo.
- Acceso predeterminado del controlador del individuo y acceso limitado por consentimiento para los demás miembros.
- Rechazo por credenciales revocadas o vencidas, dispositivos desautorizados, consentimiento retirado, otro individuo o ampliación del alcance permitido.
- Activación inicial con credenciales ICA firmadas, estado vigente y clave del controlador vinculada a la presentación.
- Verificación del resultado firmado del adaptador Gaia-X: emisor configurado, vigencia, versión de reglas e identificadores y huellas de las credenciales enviadas. Para comprobar el adaptador se utiliza un emisor de resultados controlado.

### 11.3 Trazabilidad

Fecha de ejecución: 16 de noviembre de 2026. Runtime: Node.js 26.13.0.

Código de las ejecuciones generales y del SDK: `d2fba2f7561f2a59a3881bbd75a3f2b3549279cf`.

Integración en main: `83b79c4fb25976d79bc82620058c55e0d2f4ccd7`. El estado final incorpora la declaración de tipos del cierre del KMS, comprobada mediante tipos y compilación.

El expediente local conserva:

- `core-1261-main-local-evidence.json`: versiones, commits, resultados y huellas.
- `core-1261-final-matrix-results.json`: resultado por caso y fichero.
- `core-1261-e9-added-suite-inventory.json`: inventario de los veinte ficheros y sus 114 resultados.
- `core-1261-local-sdk-result.json`: recorridos del SDK, fuentes, entorno y huellas de los logs.
- `core-1261-final-typecheck.log`, `core-1261-final-build.log` y `core-1261-final-contract-checks.log`.

### 11.4 Correspondencia con los artefactos de despliegue

Las correcciones de GW CORE 1.26.1 no modifican el código ni los manifiestos de los diez CCAAS de Fabric. Se mantiene su conjunto de artefactos de la preparación 1.26.0.

La imagen del gateway y los CCAAS son artefactos distintos. La imagen publicada de GW CORE 1.26.1 es `ghcr.io/global-datacare/gw-core@sha256:069de1bee22ab43d24b7dcb2123ebf160d983a70ef15228e7cf95c4ca25313dd`, construida desde el commit `ee166aa4870927b31731ddb7c23052ac3b7acc5e`. Las referencias operativas fijan ese digest inmutable. El expediente conserva la comprobación de versión y del rechazo del perfil stub fuera de demo en esa imagen. El digest de la imagen 1.26.0 permanece asociado a los ocho recorridos con Fabric local descritos en el apartado 10; esos resultados conservan su versión original.
