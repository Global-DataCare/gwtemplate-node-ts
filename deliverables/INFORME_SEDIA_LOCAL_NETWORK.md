# Informe consolidado de ejecución local-network

Evidencia reproducible del host del espacio de datos y aclaraciones técnicas para SEDIA

| Campo | Valor |
| --- | --- |
| Fecha de la ejecución | 21 de septiembre de 2026 |
| Ventana temporal | 19:10:54–19:29:18 UTC |
| Duración total aproximada | 18 minutos y 24 segundos, calculada a partir de los artefactos de inicio y cierre |
| Entorno demostrado | `local-network`, con Hyperledger Fabric real, PostgreSQL, IPFS/Kubo, GW CORE y despliegue Helm/kind |
| Hardware de ejecución | Intel Core i9-9880H a 2,30 GHz; 8 núcleos físicos y 16 procesadores lógicos; 32 GB de memoria; arquitectura `x86_64` |
| Identificador de ejecución | `20260921T191100Z` |
| Imagen probada | `gw-core:1.25.24-e7fdd71`, ID local `sha256:c02a3fda7dd7068fb3560f33c8c50ad8c3a0b65e0592b74eb62735d7ec951d87`, `linux/amd64` |
| Commit GW CORE | `e7fdd717a486318bfcf8ff0b9ea224bc275a9e73` |

**Conclusión ejecutiva.** Existe una ejecución única del recolector público de evidencia que recorre de forma secuencial la CA del espacio de datos, la ICA, la gobernanza y topología Fabric, GW CORE con PostgreSQL/IPFS, el acceso Consent/SMART y la instalación real mediante Helm. Las trece puertas terminaron en **PASS**. Los runners TAP, Jest y Mocha contenidos en esa ejecución registran **111 casos superados, 0 fallidos y 0 omitidos**.

## 1. Comando y formato de la evidencia

La ejecución se produce mediante el comando público:

`IMAGE_NAME="gw-core:<versión>-<commit>" npm run evidence:open-source-production-readiness`

La salida de esta ejecución queda agrupada bajo la URL completa <https://github.com/Global-DataCare/gwtemplate-node-ts/tree/main/deliverables/open-source-production-readiness/20260921T191100Z> e incluye:

- un estado `PASS` o `FAIL` por puerta;
- los logs íntegros de cada componente y recorrido;
- un resumen legible;
- un manifiesto JSON con commits, imagen, alcance, estados y hashes SHA-256;
- los informes de migración PostgreSQL/IPFS y los identificadores de contenido;
- evidencia de gobernanza, transacciones Fabric, lectura, denegación y recuperación tras reinicio.

Esta ejecución es local y reproducible. No debe presentarse como ejecución de Test Network, staging o producción.

## 2. Servicios levantados durante la ejecución local-network

La ejecución levanta localmente los siguientes servicios e infraestructuras reales:

- CA e ICA del espacio de datos. La ICA escucha en el puerto interno **3310**.
- Root CA e ICA de Fabric.
- Red Hyperledger Fabric real con orderer y peers `Host1MSP`/`Host2MSP`.
- Canales `identity-local` y `health-care-local`.
- Diez servicios de smart contracts/CCAAS.
- GW CORE, que escucha en el puerto interno **3000** y se publica en esta ejecución local mediante el puerto **18081**.
- PostgreSQL, IPFS/Kubo y CouchDB.
- Clúster Kubernetes `kind` mediante Helm.
- Flujos reales de escritura, lectura, Consent y SMART, incluyendo reinicios y persistencia.

**Alcance de la prueba.** No se limita a pruebas unitarias ni a mocks: arranca los servicios, ejecuta los recorridos contra la red local real y comprueba escritura, lectura autoritativa y persistencia.

## 3. Resultado global

| Métrica | Ejecutadas | Superadas | Fallidas | Omitidas |
| --- | --- | --- | --- | --- |
| Puertas del recolector | 13 | 13 | 0 | 0 |
| Casos automatizados contabilizados por TAP/Jest/Mocha | 111 | 111 | 0 | 0 |

Los recorridos Docker, Fabric, Kubernetes y persistencia contienen múltiples comprobaciones operativas, pero se contabilizan como puertas E2E. No se inflan artificialmente como casos unitarios adicionales.

## 4. Resultados por componente

| Componente | Casos | Superados | Fallidos | Resultado de puerta |
| --- | --- | --- | --- | --- |
| Dataspace CA: publicación, DID, JWKS, X.509 y derivación de claves | 5 | 5 | 0 | PASS |
| Dataspace ICA: contrato de Host Service VC y preautorización/activación | 44 | 44 | 0 | PASS |
| Migración ICA Firestore/GCS → PostgreSQL/IPFS | 3 | 3 | 0 | PASS |
| Gobernanza Fabric y reconciliación | 21 | 21 | 0 | PASS |
| Suite instrumentada de smart contracts | 18 | 18 | 0 | PASS |
| Taxonomía de canales humanos de GW CORE | 19 | 19 | 0 | PASS |
| Alta de empleado/BYOK DCR de GW CORE | 1 | 1 | 0 | PASS |
| **Total de casos reportados** | **111** | **111** | **0** | **PASS** |

## 5. Puertas ejecutadas

| Puerta | Resultado | Alcance principal |
| --- | --- | --- |
| 00-environment | PASS | Versiones, herramientas, repositorios e imagen de entrada. |
| 10-dataspace-ca-tests | PASS | Pruebas de CA, publicación y custodia de clave privada. |
| 11-dataspace-ca-publication | PASS | DID, JWKS, certificados y metadatos públicos. |
| 20-dataspace-ica-host-activation | PASS | Verificación, preautorización y HostingServiceCredential. |
| 21-dataspace-ica-postgres-ipfs-migration | PASS | Cuatro colecciones, objetos de auditoría, CID y comparación de digests. |
| 30-fabric-governance-contract | PASS | Decisión firmada, plan determinista, grants y reconciliación. |
| 31-fabric-multi-host-topology | PASS | Host1MSP, Host2MSP, canales, peers y lifecycle CCAAS. |
| 35-human-channel-taxonomy | PASS | Derivación y separación de canales de identidad y datos. |
| 36-employee-onboarding-contract | PASS | Alta de empleado y registro BYOK del dispositivo. |
| 40-gw-postgres-ipfs-fabric-runtime | PASS | GW CORE, escritura/lectura Fabric, PostgreSQL, IPFS, Consent y SMART. |
| 45-helm-kubernetes-runtime | PASS | Instalación real en kind, peer Host2MSP, CouchDB, GW y diez CCAAS. |
| 50-evidence-summary | PASS | Resumen y manifiesto con hashes. |
| 60-public-secret-scan | PASS | Control de publicación sin secretos. |

El texto `FAIL deliberate-failure` que aparece dentro del log de gobernanza corresponde a una prueba negativa intencionada del comportamiento fail-closed. No es un fallo de la ejecución: el caso automatizado y la puerta `30-fabric-governance-contract` terminan en PASS.

## 6. Cobertura incluida en la ejecución

La ejecución conserva el informe de cobertura de la suite instrumentada de smart contracts ejecutada dentro de la puerta Fabric:

| Métrica | Resultado |
| --- | --- |
| Sentencias | 100 % (153/153) |
| Ramas | 100 % (106/106) |
| Funciones | 100 % (33/33) |
| Líneas | 100 % (148/148) |

Los diez CCAAS quedan acreditados por su instalación, aprobación, despliegue y comprobación operativa en Fabric. Las cifras anteriores pertenecen a la suite instrumentada que produce el informe de cobertura; no representan una cobertura agregada de los diez CCAAS ni del paquete independiente `gdc-common-utils-ts`.

## 7. Evidencia funcional y de persistencia

- Fabric se inicia con `Host1MSP` y admite de forma gobernada a `Host2MSP`.
- Los peers participan en `identity-local` y `health-care-local`.
- Se verifican diez chaincodes: `organization-sc`, `cryptographickey-sc`, `employee-sc`, `evidence-sc`, `credential-sc`, `artifact-sc`, `artifactevent-sc`, `subjectkeybinding-sc`, `subjectidentifier-sc` y `consentaccess-sc`.
- GW CORE produce una transacción de aplicación con ID `af8b677153321840aee4cfc2106f60e992140a034025d0c621deefd240ff8e8d` y lectura posterior.
- La ejecución Helm conserva transacciones Fabric confirmadas con estado `VALID` y una transacción GW con ID `e9a4979a47d4839de8a1ad1f45459902422ed8d3e042cefa446e63606d7b2270`.
- La prueba final registra 55 documentos PostgreSQL, 15 blobs JWE en IPFS y recuperación correcta después de reiniciar GW, peer y CCAAS.
- El control positivo permite una lectura IPS mediante SMART al empleado autorizado; el control negativo deniega el token al empleado sin consentimiento.

### Identificador de contenido comprobado

La migración guarda y recupera el objeto sintético mediante el CID:

`bafkreihtkeofbn4tof2lhi7rupghujysfkzodwkkn6bhw3v7svm2y3tzn4`

El objeto es un PDF sintético de 48 bytes. Su SHA-256 es `f3511c50b7937174b3a3f1a3cc7a27122ab2e1d94a6f827b6ebf9559ac6e796f`. Los digests de origen transformado y destino coinciden y no quedan referencias GCS sin resolver.

## 8. Explorador, pasarela pública y subgrafo

El paquete local-network contiene transacciones, confirmaciones `VALID`, identificadores de transacción y lecturas autoritativas. Esto constituye evidencia del ledger, aunque no es una captura de una interfaz gráfica de explorador.

| Solicitud | Evidencia disponible en esta ejecución | Tratamiento recomendado |
| --- | --- | --- |
| Explorador de cadena para tres contratos | Logs Fabric con txid, estado VALID, lifecycle y readback. | Adjuntar una exportación/captura del explorador sólo si el evaluador exige específicamente la interfaz gráfica. |
| Pasarela pública por CID | CID y recuperación real en Kubo/IPFS local-network; además, CIDs JWE producidos por GW. | No describirlo como consulta a una pasarela pública desplegada sin ejecutar esa consulta en el entorno público exacto. |
| Consulta al subgrafo | No forma parte del runner GW CORE/Fabric. | Adjuntar la salida desde el backend o componente propietario del subgrafo. No sustituirla por un diagrama Mermaid. |

## 9. Aclaraciones técnicas

### 9.1 Puertos de la ICA y de GW CORE

El servicio ICA escucha en el puerto interno **3310**. GW CORE escucha en el puerto interno **3000**; durante esta ejecución local-network, Docker lo publica en el host mediante el puerto **18081**. Por tanto, **3000 no es el puerto de la ICA** y **18081 no es otro servicio**, sino el puerto local de acceso al GW CORE utilizado por el runner.

### 9.2 Salud de la imagen ICA

El contrato de código y el manifiesto Kubernetes inspeccionados usan `GET /` para liveness y readiness. La raíz devuelve `status: ok` y enlaces de descubrimiento. No se debe afirmar el comportamiento de una imagen actualmente desplegada sin comprobar su digest y consultar esa imagen exacta.

### 9.3 Funciones de GW CORE relevantes para SEDIA

- descubrimiento técnico del host y de los tenants mediante DID, JWKS, DSP/DCAT y endpoints `well-known`;
- nodo de participante autenticado con aislamiento por tenant;
- persistencia claims-first cifrada y almacenamiento separado de metadatos y blobs;
- alta de organizaciones, controllers, empleados, dispositivos y sujetos;
- Consent y autorización SMART-on-FHIR;
- ingesta clínica mediante Communication y reconstrucción de documentos/IPS;
- búsqueda autorizada del índice de sujeto y de la proyección de investigación;
- evidencia y trazabilidad mediante Hyperledger Fabric;
- ejecución asíncrona submit/poll con lectura autoritativa final.

### 9.4 Campo de reclamaciones clínicas

`resource.meta.claims` es un portador de reclamaciones específico del proyecto y **no forma parte de FHIR base**. Debe declararse como extensión/contrato claims-first del GW y SDK. Los recursos FHIR nativos se normalizan o materializan en los límites explícitos de importación, proyección o exportación.

### 9.5 SMART-on-FHIR y control de acceso por atributos

GW CORE aplica el control operativo: registra el dispositivo, emite y valida el token SMART, comprueba actor, sujeto, audiencia, consentimiento, scopes y atributos de autorización antes de acceder a los índices protegidos. El portal o BFF inicia el caso de uso y conserva la sesión del usuario, pero no decide por sí mismo la autorización clínica ni selecciona canales o smart contracts.

### 9.6 Tipos de recurso clínico

GW CORE no debe documentarse como una lista global fija de cuatro recursos. Cada base FHIR publica un `CapabilityStatement` derivado del tenant, sector, sección, versión FHIR y capacidades activadas. Si el backend afirma cuatro tipos concretos, la comparación correcta es contrastar esos cuatro con el `[base]/metadata` del entorno exacto.

### 9.7 Imagen publicada

La imagen que respalda esta evidencia es la versión 1.25.24 del commit indicado y es definitiva para esta ejecución reproducible. No debe presentarse como compilación de cualquier cambio posterior de `main`. La documentación pública referencia un digest OCI inmutable para la distribución auditada; una imagen actualizada requiere su propia ejecución y evidencia ligada al nuevo digest.

### 9.8 Documentación pública

El repositorio [Global-DataCare/gwtemplate-node-ts](https://github.com/Global-DataCare/gwtemplate-node-ts) es público y se presenta como punto de entrada del entregable. El paquete de evidencia `20260921T191100Z` se incluye bajo `deliverables/open-source-production-readiness/` para que el evaluador pueda consultar el resumen, los logs, los estados y el manifiesto de la ejecución.

## 10. Casos representativos conservados por nombre

Los logs conservan los nombres y tiempos de los casos TAP/Mocha. Entre ellos:

- `static publication binds DID, JWKS, X.509 chain and trust pins` — PASS.
- `ICA runtime derivation profile reproduces the dataspace-ica VC signing key contract` — PASS.
- `signed host-service PDF exposes every field required for Service VC issuance` — PASS.
- `preauthorized local-network host is accepted without a PDF and produces governed evidence` — PASS.
- `one-time host activation verifies the submitted JWK without DNS or a mounted DID document` — PASS.
- `persists and atomically consumes one host activation in PostgreSQL` — PASS.
- `Kubo stores and retrieves the exact migrated audit bytes by CID` — PASS.
- `validates inventory-bound decisions and builds an exact deterministic plan` — PASS.
- `apply re-inspects every step, persists completion and is idempotent` — PASS.
- `creates a sanitized consent access bundle and writes it to state` — PASS.
- `upserts by returning the previous asset when the sanitized data is identical` — PASS.
- `builds consent access history through both method names` — PASS.

Para la entrega exhaustiva, los logs originales son la fuente canónica de los 111 resultados. Los dos ficheros Jest de taxonomía contienen 19 casos superados, aunque esa invocación no imprimió cada nombre individual; sí conserva los nombres de los ficheros, el total, el estado y el tiempo.

## 11. Referencias del paquete de evidencia

**Resumen:**

<https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/deliverables/open-source-production-readiness/20260921T191100Z/SUMMARY.md>

**Manifiesto:**

<https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/deliverables/open-source-production-readiness/20260921T191100Z/manifest.json>

**Logs:**

<https://github.com/Global-DataCare/gwtemplate-node-ts/tree/main/deliverables/open-source-production-readiness/20260921T191100Z/logs>

**Estados de las puertas:**

<https://github.com/Global-DataCare/gwtemplate-node-ts/tree/main/deliverables/open-source-production-readiness/20260921T191100Z/gates>

**Evidencia PostgreSQL/IPFS de la ICA:**

<https://github.com/Global-DataCare/gwtemplate-node-ts/tree/main/deliverables/open-source-production-readiness/20260921T191100Z/dataspace-ica-postgres-ipfs>
