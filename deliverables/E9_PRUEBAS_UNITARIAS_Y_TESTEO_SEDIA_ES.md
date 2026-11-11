# Entregable E9: pruebas unitarias y testeo

## 1. Objeto y entorno de ejecución

El Entregable E9 documenta las pruebas de los paquetes de utilidades, los SDK, el servicio de certificación ICA y su cliente. La validación comprende pruebas unitarias, comprobaciones de integración y recorridos completos entre las aplicaciones, el gateway y la ICA.

| Parámetro | Valor |
|---|---|
| Fecha de ejecución | 11 de noviembre de 2026 |
| Sistema | macOS |
| Node.js | `v26.13.0` |
| npm | `11.20.0` |
| Entorno de pruebas | Local, con perfiles test/demo |
| Integración | Procesos reales de GW e ICA mediante HTTP |

La ejecución finaliza con todas las baterías superadas y cero casos fallidos, omitidos, cancelados o pendientes.

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
