# Puesta en marcha de un host: test-network y producción

Esta guía comienza cuando la ICA del espacio de datos ya está operativa. No
migra staging a producción: crea identidades, certificados, Secrets y PVC
nuevos para cada red.

## 1. Responsables

Cada fase corresponde a uno de estos responsables:

| Responsable | Qué hace | Qué no recibe ni hace |
| --- | --- | --- |
| Comité de Gobernanza | Aprueba el procedimiento aplicable y los acuerdos sobre los canales | No ejecuta la operación técnica diaria |
| Responsable de la validación técnica | Valida la incorporación conforme a la sección 10.4 del Rulebook: el Operador del Espacio cuando esté designado o, en su defecto, el Nodo Operador anfitrión y la ICA correspondiente | No genera la clave privada del nuevo Nodo Operador |
| Operador de la ICA del espacio de datos | Configura la preautorización, crea la activación de un uso y mantiene el endpoint de emisión | No emite certificados MSP/TLS de Fabric |
| Equipo DevOps del Nodo Operador | Genera y custodia la clave del host, solicita la Host VC y despliega Helm | No recibe la identidad registradora de la ICA de Fabric |
| Entidad autorizada para administrar Fabric | Custodia la identidad registradora de la ICA de Fabric y el administrador de cada MSP | No recibe las claves privadas del peer, TLS ni cliente GW |
| Equipo DevOps de Fabric | Valida la Host VC, registra los grants y ejecuta los cambios de canales acordados | No entrega las identidades administrativas al Nodo Operador |

La **ICA del espacio de datos** emite la `HostingServiceCredential`. La
**ICA de Fabric** emite después los certificados X.509 MSP/TLS. Son servicios,
credenciales y responsabilidades diferentes.

La **identidad registradora de la ICA de Fabric** y el **administrador del MSP**
son identidades diferentes. Ambas son **identidades administrativas de Fabric**.
La primera registra los identificadores de
enrolamiento en la ICA de Fabric; la segunda administra el MSP en las
operaciones autorizadas de configuración y lifecycle. La **entidad autorizada
para administrar Fabric** custodia ambas identidades y su **equipo DevOps de
Fabric** las utiliza para ejecutar las operaciones aprobadas. El equipo DevOps
del Nodo Operador no recibe ninguna de las dos: solo recibe los grants temporales.

Un grant temporal de enrolamiento no es un certificado. Contiene el
identificador y el secreto temporales necesarios para solicitarlo a la ICA de
Fabric. Al consumir el grant, la clave privada se genera dentro del Nodo
Operador y la ICA de Fabric devuelve el certificado X.509. El grant del peer
permite los enrolamientos MSP y TLS; el grant del cliente GW permite su
enrolamiento MSP. Ninguno incorpora por sí solo el peer a los canales.
La ICA de Fabric devuelve directamente los certificados al Nodo Operador. No
pasan por el equipo DevOps de Fabric.

Esta guía utiliza **Nodo Operador, que actúa como Proveedor de Alojamiento para
alojar organizaciones proveedoras o consumidoras de servicios de índice o de
gemelos digitales**, con el significado definido en el Rulebook: la
infraestructura técnica acreditada que aloja participantes y presta servicios
en el Espacio. El **equipo DevOps del Nodo Operador** ejecuta los comandos de
despliegue y operación descritos a continuación.

Conforme a la sección 10.4 del Rulebook, el Nodo Operador debe demostrar
capacidad técnica, mecanismos de identidad y confianza, publicación de
artefactos y controles de Compute to Data cuando apliquen. Su habilitación exige
la validación técnica indicada en esa sección. La sección 13.3 le atribuye las
obligaciones contractuales y normativas sobre seguridad, disponibilidad de la
infraestructura y protección de datos.

## Procedimiento completo de incorporación del host

El operador de la ICA del espacio de datos genera una activación de un solo uso
desde el pod; la redirección guarda el fichero en su propio ordenador. El
equipo DevOps del Nodo Operador recibe ese fichero por un canal seguro y, mediante el
asistente del host, envía a la ICA la activación, la clave pública JWK y la firma
de la solicitud. La ICA emite la `HostingServiceCredential` para el host
aprobado.

Después, el equipo DevOps del Nodo Operador entrega esa credencial al equipo
DevOps de Fabric. El identificador MSP se asigna conforme al procedimiento
aprobado; el equipo DevOps del Nodo Operador no lo
elige unilateralmente. El equipo DevOps de Fabric verifica la credencial,
provisiona bajo custodia de la entidad autorizada el administrador de ese MSP y
registra en la ICA de Fabric dos
grants temporales: uno con dos usos para que el host genere localmente la
identidad MSP y el certificado TLS del peer, y otro de un uso para la identidad
cliente con la que GW CORE del host accede a Fabric. El equipo DevOps del Nodo Operador
recibe esos identificadores/secretos temporales y la cadena TLS pública de la
ICA de Fabric. Cuando el equipo DevOps del Nodo Operador ejecuta el asistente, las claves
privadas y certificados se generan y quedan bajo custodia del propio host.

El administrador del MSP queda bajo custodia de la entidad autorizada para
administrar Fabric y nunca se entrega al Nodo Operador. El equipo DevOps de
Fabric produce la definición pública del MSP a partir de la cadena emisora y del
certificado público de administración. El Nodo Operador sólo comunica su endpoint y los
certificados o huellas públicas de operación que produzca el asistente.

Los certificados acreditan las identidades, pero la pertenencia a los canales
se gobierna aparte. Si el mismo Nodo Operador y ámbito administrativo reutilizan un
MSP ya admitido, no se crea otro MSP: se emiten identidades nuevas para el peer
y se comprueba su incorporación.

## 2. Acordar y aprobar la hoja de entrada

El equipo DevOps del Nodo Operador no ejecuta el alta hasta que la aprobación
formal y los datos técnicos hayan quedado reflejados en esta hoja. Los campos marcados como aprobación ICA
se copian después, sin cambios, al fichero `approved-host.json` del paso 5:

```text
Entorno (aprobación ICA): test-network | network
Dominio HTTPS del host (aprobación ICA):
URL de la ICA del espacio de datos:
Jurisdicción (aprobación ICA):
Contexto de emisión (aprobación ICA):
Razón social del Nodo Operador (aprobación ICA):
VAT/TAX/identificador oficial (aprobación ICA):
País:
Email del controller del host (aprobación ICA):
Identificador estable del controller:
Rol ISCO-08 del controller:
MSP asignado conforme al procedimiento aprobado:
Canales acordados conforme al procedimiento aprobado:
IP fija de salida hacia la ICA de Fabric:
Namespace y release Helm:
StorageClass e IngressClass:
DNS/TLS del GW y del peer:
```

La aprobación formal confirma por escrito identidad legal, dominio, controller,
contexto de emisión y entorno. El equipo DevOps de Fabric confirma el MSP y los
canales conforme al procedimiento aprobado. En `test-network`
se usa una autorización de staging; para `network` se repite
todo con una autorización productiva nueva. Estas aprobaciones no configuran
Kubernetes por sí solas: cada equipo aplica después únicamente la parte que le
corresponde.

## 3. Equipo DevOps del Nodo Operador: preparar el checkout y el manifiesto privado

```bash
git clone https://github.com/Global-DataCare/gwtemplate-node-ts.git
cd gwtemplate-node-ts
npm ci

install -d -m 700 /secure/host/bootstrap /secure/onboarding /secure/inventory
cp configs/host-credential-request.example.json \
  /secure/onboarding/host-credential-request.json
chmod 600 /secure/onboarding/host-credential-request.json
```

`host-credential-request.json` es el fichero de entrada del comando del paso 4.
Todavía no contiene la credencial ni una clave privada. Reúne en un solo lugar
los datos que necesita el comando:

- a qué ICA del espacio de datos debe llamar;
- qué dominio y Nodo Operador se están autorizando;
- si el alta corresponde a staging o producción;
- en qué rutas privadas debe crear la clave y guardar la credencial obtenida.

```text
Aprobación formal de dominio + red
        |
        +-- operador ICA ------> crea host-activation.json desde el pod
        |                         y lo captura en su ordenador
        |
        +-- entrega privada ---> equipo DevOps recibe la activación
        |
        +-- comando --init ----> genera la clave privada de solicitud
        |
        +-- comando --request -> envía activación + JWK + firma
        |                         y recibe host-credential.json
        |
        +-- Helm inicia GW -----> GW/KMS genera y publica el DID operativo
```

La solicitud lleva la JWK pública y el `kid`; la firma demuestra posesión de la
clave privada y la activación de un solo uso acredita la autorización previa
registrada en la ICA. `thid` solo correlaciona la operación asíncrona y nunca se
usa como contraseña.

Se mantiene fuera de Git porque contiene los datos reales del Nodo Operador y
del controller y porque referencia las rutas donde se
crearán materiales privados.
El equipo DevOps del Nodo Operador parte de esta estructura para producción:

```json
{
  "verifyUrl": "https://ica.example.org/ica/cds-ES/v1/onehealth-research/network/pdf/contract/_verify",
  "hostDomain": "host.provider.example",
  "serviceUrl": "https://host.provider.example",
  "jurisdiction": "ES",
  "sector": "onehealth-research",
  "networkKind": "network",
  "legalName": "<razón-social-aprobada>",
  "addressCountry": "ES",
  "taxId": "<identificador-fiscal-aprobado>",
  "controllerEmail": "<email-controller-aprobado>",
  "privateJwkFile": "/secure/host/bootstrap/host-signing.private.jwk.json",
  "activationFile": "/secure/onboarding/host-activation.json",
  "credentialOutputFile": "/secure/host/bootstrap/host-credential.json"
}
```

El DevOps sustituye solamente los valores entre `<...>` y los dos dominios
`.example`. Las rutas bajo `/secure` son ubicaciones privadas del equipo del
host, no rutas del pod de la ICA. Pueden adaptarse a su sistema manteniendo los
permisos y actualizando el manifiesto.

Significado de los campos que suelen producir confusión:

| Campo | Valor que debe introducirse |
| --- | --- |
| `verifyUrl` | URL exacta entregada por el DevOps de la ICA del espacio de datos |
| `hostDomain` | Dominio del nuevo host, sin `https://` ni rutas |
| `serviceUrl` | El mismo dominio anterior con `https://` |
| `jurisdiction` | País o jurisdicción bajo la que se emite la credencial |
| `sector` | Contexto sectorial de la transacción de verificación de la ICA; `onehealth-research` solo es el valor de este ejemplo |
| `networkKind` | `test-network` para staging o `network` para producción |
| `privateJwkFile` | Ruta donde el comando creará la clave privada de la solicitud |
| `activationFile` | Fichero privado recibido del operador de la ICA; contiene la activación de un solo uso |
| `credentialOutputFile` | Ruta donde el comando guardará la Host VC emitida |

`verifyUrl` no se inventa a partir del dominio del host. Es el endpoint HTTP de
la **ICA del espacio de datos** que recibe la solicitud y emite la Host VC. El
sufijo `_verify` es solamente el nombre de esa operación HTTP; no es otro
servicio ni un fichero. El DevOps de la ICA debe entregar la URL completa.

### No confundir entorno, contexto de emisión y sectores alojados

Son tres configuraciones diferentes:

| Configuración | Ejemplo | Qué controla |
| --- | --- | --- |
| `networkKind` / Helm `networkMode` | `test-network` o `network` | Red de staging o de producción a la que pertenece el host |
| `sector` de la transacción de la ICA | `onehealth-research` en este ejemplo | Contexto sectorial que exige la ruta compartida de verificación de la ICA y que también usa la credencial de organización emitida en esa transacción |
| Helm `host.allowedSectors` | lista de sectores de negocio | Sectores cuyas operaciones admite el GW |

La `HostingServiceCredential` acredita la URL y el Nodo Operador, y su sujeto no
contiene ese sector. La operación compartida de la
ICA exige no obstante un `{sector}` como contexto de emisión. El registro
interno del propio host usa la categoría técnica reservada `system`. El host
puede admitir varios
sectores mediante `host.allowedSectors`, siempre que la autorización formal,
los canales y las políticas desplegadas los autoricen.

Por tanto, que el manifiesto anterior use `sector: onehealth-research` no
significa que el host solo pueda alojar ese sector. Si la aprobación establece
`health-care`, tanto el campo como el segmento de `verifyUrl` deben usar
`health-care`; no se mezclan. La lista efectiva de sectores admitidos se
configura después en los values de Helm, por ejemplo:

```yaml
networkMode: network
host:
  allowedSectors:
    - onehealth-research
    - health-care
    - health-research
    - animal-research
```

En las rutas de registro del propio GW, el parámetro histórico llamado
`{sector}` recibe realmente el entorno del host (`local-network`,
`test-network` o `network`). Los sectores de negocio permanecen separados en
`host.allowedSectors`.

La organización propietaria u operadora se utiliza al arrancar para crear el
registro interno reservado `host` y su controller inicial.

Si la ICA solo tiene acceso interno por `ClusterIP`, el DevOps ejecuta la
solicitud desde una máquina o un Job con acceso a esa URL interna. Si dispone
de DNS HTTPS público, usa su URL pública. El equipo que opera la ICA debe
facilitar la URL exacta; el equipo DevOps del Nodo Operador no debe adivinarla.

Para `test-network`, los tres valores coherentes son:

```text
networkKind: test-network
hostDomain: dominio de staging aprobado
verifyUrl: ruta de la ICA de staging que contiene /test-network/
```

Para producción son:

```text
networkKind: network
hostDomain: dominio de producción aprobado
verifyUrl: ruta de la ICA de producción que contiene /network/
```

No se reutilizan entre entornos la clave privada ni la Host VC.

## 4. Equipo DevOps del Nodo Operador: generar la clave privada de la solicitud

```bash
node scripts/onboarding/request-host-credential.mjs \
  --manifest /secure/onboarding/host-credential-request.json --init
```

Salida:

- `host-signing.private.jwk.json`: clave de la solicitud; permanece bajo
  custodia del Nodo Operador, modo `0600`.

La clave privada demuestra que el solicitante autorizado controla la firma de
esta solicitud para el dominio declarado. No es una clave de Fabric, no es la
clave KMS operativa del GW y nunca se envía fuera del Nodo Operador.

El comando `--init` genera la clave automáticamente. `--request` obtendrá de
ella la JWK pública, incluirá el `kid` y firmará el contenido exacto sin que el
operador tenga que construir criptografía manualmente.

Después de instalar Helm, GW genera y custodia sus claves operativas mediante
su adaptador KMS y publica automáticamente el DID operativo del dominio en:

```text
https://<dominio-del-host>/.well-known/did.json
```

GW genera y publica automáticamente ese documento operativo.

## 5. Aprobación formal y operador de la ICA: crear la activación

El operador de la ICA comprueba que dominio, identidad legal, controller y
entorno coinciden con la aprobación formal. La ICA mantiene permitidos el
dominio y la red:

```dotenv
ICA_PREAUTHORIZED_HOST_DOMAINS=<dominio-exacto>
ICA_PREAUTHORIZED_HOST_NETWORK_KINDS=<test-network-o-network>
```

El operador de la ICA ejecuta lo siguiente en el ordenador donde ya funciona
`kubectl`.
Primero crea su copia privada de la aprobación y sustituye los valores de
ejemplo por los ya aprobados; no inventa ni modifica datos en este paso:

```bash
export HOST_HANDOFF_DIR="${HOME}/gdc-host-handoff"
install -d -m 700 "${HOST_HANDOFF_DIR}"

cp configs/host-activation-approval.example.json \
  "${HOST_HANDOFF_DIR}/approved-host.json"
chmod 600 "${HOST_HANDOFF_DIR}/approved-host.json"
```

`approved-host.json` contiene exactamente dominio, URL, red, jurisdicción,
contexto de emisión, identidad legal y email del controller. Si el Nodo Operador
no usa `taxId`, se sustituye ese campo por `identifierType` e
`identifierValue`. Después el operador de la ICA lo envía por la entrada estándar del
comando que corre en el pod:

```bash
kubectl --context '<contexto>' \
  --namespace '<namespace-ica>' \
  exec -i deployment/<deployment-ica> -- \
  node ./bin/ica-cli.js host:activation:create \
    --approval-stdin \
    --expires-in 72h \
    --created-by '<id-estable-operador-ica>' \
  < "${HOST_HANDOFF_DIR}/approved-host.json" \
  > "${HOST_HANDOFF_DIR}/host-activation.json"

chmod 600 "${HOST_HANDOFF_DIR}/host-activation.json"
```

El comando se ejecuta dentro del pod porque necesita las mismas variables y la
misma base de datos que la ICA. El carácter `<` lee la aprobación desde el
ordenador local y la envía al proceso sin copiarla al disco del pod. El carácter
`>` guarda la respuesta en `${HOME}/gdc-host-handoff` del ordenador que ejecutó
`kubectl`, no dentro del pod. En PostgreSQL o Firestore queda el SHA-256 del
código junto con los datos aprobados, red, caducidad y estado; nunca el código
original.

El fichero de salida contiene la activación y una copia de los datos aprobados.
El operador de la ICA entrega `host-activation.json` cifrado por un canal privado. No lo
copia en Git, correo sin cifrar, WhatsApp, Helm, ConfigMap ni logs. El equipo
DevOps del Nodo Operador lo guarda como `/secure/onboarding/host-activation.json` con modo
`0600`. La activación caduca, pertenece a un solo dominio/red y se consume una
sola vez. Si falla después de consumirse, el operador de la ICA genera otra.

El operador de la ICA puede comprobar los metadatos sin mostrar el código:

```bash
jq 'del(.activationCode)' "${HOST_HANDOFF_DIR}/host-activation.json"
```

## 6. Equipo DevOps del Nodo Operador: solicitar la HostingServiceCredential

Cuando el equipo DevOps del Nodo Operador tenga la activación privada y la clave del paso 4:

```bash
node scripts/onboarding/request-host-credential.mjs \
  --manifest /secure/onboarding/host-credential-request.json --request
```

Antes de llamar a la ICA, el asistente comprueba que todos los datos del
manifiesto coinciden con la aprobación incluida en la activación. Después firma
y envía la solicitud, espera el resultado y guarda
`host-credential.json` con la VC JSON y la VC-JWT. El equipo DevOps del Nodo Operador no necesita
construir JWS, claims ni llamadas HTTP manualmente.

No continúe si la credencial no contiene `HostingServiceCredential`, si su
sujeto no es la URL exacta del host o si el controller/identidad legal no
coinciden con la aprobación.

Hasta aquí solo se ha autorizado el servicio de alojamiento. Todavía no se han
generado certificados MSP/TLS ni se ha incorporado ningún peer a Fabric.

<a id="7-administrador-de-fabric-registrar-y-custodiar-el-administrador-del-msp"></a>

## 7. Equipo DevOps de Fabric: registrar y gestionar el administrador del MSP

El equipo DevOps del Nodo Operador entrega por canal seguro:

- Host VC-JWT;
- dominio y MSP asignado conforme al procedimiento aprobado;
- canales aprobados;
- IP fija de salida.

El **equipo DevOps de Fabric**, no el equipo DevOps del Nodo Operador ni el operador de la ICA del
espacio de datos, incorpora ese MSP al inventario gobernado. El valor de
`mspId` incluido en la solicitud debe coincidir exactamente con la decisión
firmada: el host no puede inventar ni modificar el nombre. Después usa la
identidad registradora de la ICA de Fabric y ejecuta el asistente público:

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role authority

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role authority \
  --apply --confirm-request '<request-id-firmado>'
```

El asistente crea bajo las rutas `authority.mspAdminOutputDir` y
`authority.publicMspOutputDir`:

- la identidad y clave privada `<MSP>.admin`, bajo custodia de la entidad
  autorizada para administrar Fabric;
- la definición pública saneada del MSP, sin secretos ni claves privadas.

El mismo contrato puede auditarse por separado con
`scripts/enrollment/provision-governed-msp-admin.sh`. Si ambas rutas ya existen
y coinciden en MSP, red e ICA de Fabric, el asistente reutiliza la identidad
sin volver a registrarla; si el material gestionado está incompleto o no coincide, se
detiene sin sobrescribirla. Así varios peers aprobados del mismo Nodo Operador
pueden pertenecer al mismo MSP.
`authority.caName` identifica la ICA de Fabric exacta y se conserva en ambos
grants para que el host no pueda enrolarse accidentalmente contra otra CA.

Salida hacia el equipo DevOps del Nodo Operador: un paquete privado cifrado, verificable por su
manifiesto de hashes y compuesto exactamente por:

```text
peer-enrollment-grant.json
gw-client-enrollment-grant.json
fabric-ica-ca-chain.pem
fabric-endpoints.json
authorization.json
host-apply-confirmation.json
onboarding.host.json
manifest.sha256
```

`authorization.json` es el resultado saneado que vincula la Host VC verificada,
el dominio, la red, el MSP y los canales aprobados; no contiene la VC-JWT.
`host-apply-confirmation.json` contiene el `requestId` que protege la aplicación
y `onboarding.host.json` fija únicamente las rutas y salidas privadas que usa el
rol `host`. Nunca se entrega el administrador del MSP, la identidad
registradora de la ICA de Fabric, el inventario completo de la red ni claves
privadas bajo custodia de la entidad autorizada para administrar Fabric.

## 8. Equipo DevOps del Nodo Operador: generar MSP/TLS dentro del host

```bash
cd /secure/onboarding
shasum -a 256 -c manifest.sha256
request_id="$(jq -r '.governanceDecision.decision.requestId' \
  host-apply-confirmation.json)"

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.host.json --role host

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.host.json --role host \
  --apply --confirm-request "${request_id}"
```

Salida: MSP/TLS del peer, identidad cliente del GW, `gw.fabric.env` y paquete
saneado para Kubernetes. Las claves privadas nunca salen del host.

## 9. Equipo DevOps del Nodo Operador: configurar e instalar el chart común

Los values deben contener la identidad legal del Nodo Operador, su controller
inicial y los sectores que el host acepta. El email debe coincidir con el
controller aprobado en la solicitud de la Host VC:

```yaml
networkMode: network
host:
  legalName: <razón-social-aprobada>
  idType: <tipo-identificador>
  idValue: <identificador-legal>
  adminEmail: <email-controller-aprobado>
  adminUid: <identificador-estable-controller>
  adminRole: <rol-ISCO-08>
  allowedSectors:
    - <sector-autorizado>
peer:
  channels:
    - identity-global
    - identity-eu
    - health-care-eu
    - animal-pet-eu
```

Al arrancar, GW crea automáticamente el registro técnico reservado `host`,
genera sus claves KMS y publica su DID operativo. Ese registro representa al
Nodo Operador.

`peer.channels` contiene canales Fabric, no sectores del GW. Debe enumerar
todos los canales ya aprobados para el MSP que el nuevo peer debe unir. Helm
valida e inyecta la lista, mientras que el equipo DevOps de Fabric realiza y
verifica la unión efectiva.

```bash
helm pull oci://ghcr.io/global-datacare/gdc-host --version 0.3.2

bash scripts/validate-host-helm-values.sh \
  /secure/inventory/host.values.yaml '<namespace>' '<release>'

helm upgrade --install '<release>' oci://ghcr.io/global-datacare/gdc-host \
  --version 0.3.2 --namespace '<namespace>' --create-namespace \
  --values /secure/inventory/host.values.yaml \
  --atomic --wait --timeout 15m
```

Los `values` referencian Secrets ya creados para MSP, TLS, autorización, GW,
PostgreSQL y CouchDB. No contienen claves, grants, VC-JWT ni contraseñas.

## 10. Equipo DevOps de Fabric: incorporar el MSP y aceptar el host

Cuando el peer esté accesible, el host comunica su endpoint y la información
pública de verificación producida durante el enrolamiento. No entrega carpetas
MSP privadas. El administrador utiliza la definición pública gobernada para
incorporar el MSP a los canales y la identidad `<MSP>.admin` que gestiona para
unir el peer y aprobar el lifecycle de esa organización.

El equipo DevOps de Fabric aplica el reconciliador con su inventario privado:

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role platform

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role platform \
  --apply --confirm-request '<request-id-firmado>'
```

El equipo DevOps del Nodo Operador y el equipo DevOps de Fabric comprueban pods, PVC, peer,
canales, CCAAS, escritura, lectura, denegación, reinicio y restauración. Un pod
en estado `Running` no es una aceptación.

La guía técnica ampliada está en
[`GUIA_OPERATIVA_HOST_ES.md`](./GUIA_OPERATIVA_HOST_ES.md).
