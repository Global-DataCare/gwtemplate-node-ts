# Puesta en marcha de un host: test-network y producción

Esta guía comienza cuando la ICA del espacio de datos ya está operativa. No
migra staging a producción: crea identidades, certificados, Secrets y PVC
nuevos para cada red.

## 1. Responsables

Cada fase corresponde a uno de estos responsables:

| Responsable | Qué hace | Qué no recibe ni hace |
| --- | --- | --- |
| Gobernanza del espacio de datos | Aprueba por escrito el proveedor, dominio, controller y entorno | No genera la clave privada del host ni administra su Kubernetes |
| Operador de la ICA del espacio de datos | Configura la preautorización, crea la activación de un uso y mantiene el endpoint de emisión | No emite certificados MSP/TLS de Fabric |
| DevOps del host | Genera y custodia la clave del host, solicita la Host VC y despliega Helm | No recibe la identidad administradora de Fabric CA |
| Administrador de Fabric | Valida la Host VC, registra los grants MSP/TLS y gobierna MSP y canales | No recibe la clave privada del host |

La **ICA del espacio de datos** emite la `HostingServiceCredential`. La
**ICA de Fabric** emite después los certificados X.509 MSP/TLS. Son servicios,
credenciales y responsabilidades diferentes.

## Flujo completo en lenguaje directo

El flujo ya no requiere un `did.json` previo. El operador de la ICA del espacio
de datos genera una activación de un solo uso desde el pod; la redirección
guarda el fichero en su propio ordenador. El responsable del host recibe ese
fichero por un canal seguro y, mediante el asistente del host, envía a la ICA la
activación, la clave pública JWK y la firma de la solicitud. La ICA emite la
`HostingServiceCredential` para el host aprobado.

Después, el responsable del host entrega esa credencial al administrador de
Fabric. Este administrador la verifica y registra en la ICA de Fabric dos
grants temporales: uno con dos usos para que el host genere localmente la
identidad MSP y el certificado TLS del peer, y otro de un uso para la identidad
cliente con la que GW CORE del host accede a Fabric. El responsable del host
recibe esos identificadores/secretos temporales y la cadena TLS pública de la
ICA de Fabric. Al ejecutar el responsable del host el asistente, las claves
privadas y certificados se generan y quedan bajo custodia del propio host.

Los certificados acreditan las identidades, pero la pertenencia a los canales
se gobierna aparte. Si se reutiliza un MSP que ya está admitido y sus canales ya
están configurados, no se crea otro MSP; se emiten identidades nuevas de ese MSP
y se comprueba la incorporación del nuevo peer.

## 2. Acordar y aprobar la hoja de entrada

El DevOps del host no ejecuta el alta hasta que gobernanza y los equipos
técnicos hayan completado esta hoja. Los campos marcados como aprobación ICA
se copian después, sin cambios, al fichero `approved-host.json` del paso 5:

```text
Entorno (aprobación ICA): test-network | network
Dominio HTTPS del host (aprobación ICA):
URL de la ICA del espacio de datos:
Jurisdicción (aprobación ICA):
Contexto de emisión (aprobación ICA):
Razón social del proveedor (aprobación ICA):
VAT/TAX/identificador oficial (aprobación ICA):
País:
Email del controller del host (aprobación ICA):
Identificador estable del controller:
Rol ISCO-08 del controller:
MSP ID solicitado:
Canales solicitados:
IP fija de salida hacia la ICA de Fabric:
Namespace y release Helm:
StorageClass e IngressClass:
DNS/TLS del GW y del peer:
```

Gobernanza confirma por escrito identidad legal, dominio, controller, contexto
de emisión y entorno. El administrador de Fabric confirma por escrito MSP y
canales. En `test-network` se usa una autorización de staging; para `network` se repite
todo con una autorización productiva nueva. Estas aprobaciones no configuran
Kubernetes por sí solas: cada DevOps aplica después únicamente la parte que le
corresponde.

## 3. DevOps del host: preparar el checkout y el manifiesto privado

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
- qué dominio y proveedor se están autorizando;
- si el alta corresponde a staging o producción;
- en qué rutas privadas debe crear la clave y guardar la credencial obtenida.

```text
Gobernanza aprueba dominio + red
        |
        +-- operador ICA ------> crea host-activation.json desde el pod
        |                         y lo captura en su ordenador
        |
        +-- entrega privada ---> DevOps del host recibe la activación
        |
        +-- comando --init ----> genera la clave privada de solicitud
        |
        +-- comando --request -> envía activación + JWK + firma
        |                         y recibe host-credential.json
        |
        +-- Helm inicia GW -----> GW/KMS genera y publica el DID operativo
```

No se genera ni intercambia un `did.json` provisional. La solicitud ya lleva
la JWK pública y el `kid`; la firma demuestra posesión de la clave privada y la
activación de un solo uso aporta la autorización de gobernanza. `thid` solo
correlaciona la operación asíncrona y nunca se usa como contraseña.

Se mantiene fuera de Git porque contiene los datos reales del proveedor y del
controller y porque referencia las rutas donde se crearán materiales privados.
El DevOps del host parte de esta estructura para producción:

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
| Helm `host.allowedSectors` | lista de sectores de negocio | Sectores en los que el GW admite posteriormente tenants y operaciones |

La `HostingServiceCredential` acredita la URL y el proveedor del servicio de
alojamiento y su sujeto no contiene ese sector. La operación compartida de la
ICA exige no obstante un `{sector}` para tramitar la verificación y emitir
también la credencial de organización correspondiente. Esto no convierte al
host en un tenant de `onehealth-research`. El registro interno del propio host
usa la categoría técnica reservada `system`. El host puede admitir varios
sectores mediante `host.allowedSectors`, siempre que la decisión de gobernanza,
los canales y las políticas desplegadas los autoricen. No se solicita una nueva
Host VC por cada tenant.

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
`test-network` o `network`). Los sectores de negocio de los tenants permanecen
separados en `host.allowedSectors`.

La organización propietaria u operadora se utiliza al arrancar para crear el
registro interno reservado `host` y su controller inicial. Esto no la registra
automáticamente como tenant de negocio. Si esa misma organización debe ser el
primer tenant alojado, realiza después el alta normal de tenant en uno de los
sectores incluidos en `host.allowedSectors`.

Si la ICA solo tiene acceso interno por `ClusterIP`, el DevOps ejecuta la
solicitud desde una máquina o un Job con acceso a esa URL interna. Si dispone
de DNS HTTPS público, usa su URL pública. El equipo que opera la ICA debe
facilitar la URL exacta; el DevOps del host no debe adivinarla.

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

## 4. DevOps del host: generar la clave privada de la solicitud

```bash
node scripts/onboarding/request-host-credential.mjs \
  --manifest /secure/onboarding/host-credential-request.json --init
```

Salida:

- `host-signing.private.jwk.json`: clave de la solicitud; permanece bajo
  custodia del operador, modo `0600`.

La clave privada demuestra que el solicitante autorizado controla la firma de
esta solicitud para el dominio declarado. No es una clave de Fabric, no es la
clave KMS operativa del GW y nunca se envía a gobernanza, a la ICA ni al
administrador de Fabric.

El comando `--init` genera la clave automáticamente. `--request` obtendrá de
ella la JWK pública, incluirá el `kid` y firmará el contenido exacto sin que el
operador tenga que construir criptografía manualmente.

Después de instalar Helm, GW genera y custodia sus claves operativas mediante
su adaptador KMS y publica automáticamente el DID operativo del dominio en:

```text
https://<dominio-del-host>/.well-known/did.json
```

Ese documento operativo no se copia manualmente desde el fichero anterior.

## 5. Gobernanza y operador de la ICA: crear y entregar la activación

Gobernanza comprueba que dominio, identidad legal, controller y entorno
coinciden con la hoja aprobada. La ICA mantiene permitidos el dominio y la red:

```dotenv
ICA_PREAUTHORIZED_HOST_DOMAINS=<dominio-exacto>
ICA_PREAUTHORIZED_HOST_NETWORK_KINDS=<test-network-o-network>
```

El operador ejecuta lo siguiente en el ordenador donde ya funciona `kubectl`.
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
contexto de emisión, identidad legal y email del controller. Si el proveedor
no usa `taxId`, se sustituye ese campo por `identifierType` e
`identifierValue`. Después el operador lo envía por la entrada estándar del
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
El operador entrega `host-activation.json` cifrado por un canal privado. No lo
copia en Git, correo sin cifrar, WhatsApp, Helm, ConfigMap ni logs. El DevOps
del host lo guarda como `/secure/onboarding/host-activation.json` con modo
`0600`. La activación caduca, pertenece a un solo dominio/red y se consume una
sola vez. Si falla después de consumirse, el operador genera otra.

El operador puede comprobar los metadatos sin mostrar el código:

```bash
jq 'del(.activationCode)' "${HOST_HANDOFF_DIR}/host-activation.json"
```

## 6. DevOps del host: solicitar la HostingServiceCredential

Cuando el DevOps del host tenga la activación privada y la clave del paso 4:

```bash
node scripts/onboarding/request-host-credential.mjs \
  --manifest /secure/onboarding/host-credential-request.json --request
```

Antes de llamar a la ICA, el asistente comprueba que todos los datos del
manifiesto coinciden con la aprobación incluida en la activación. Después firma
y envía la solicitud, espera el resultado y guarda
`host-credential.json` con la VC JSON y la VC-JWT. El operador no necesita
construir JWS, claims ni llamadas HTTP manualmente.

No continúe si la credencial no contiene `HostingServiceCredential`, si su
sujeto no es la URL exacta del host o si el controller/identidad legal no
coinciden con la aprobación.

Hasta aquí solo se ha autorizado el servicio de alojamiento. Todavía no se han
generado certificados MSP/TLS ni se ha incorporado ningún peer a Fabric.

## 7. Administrador de Fabric: registrar los grants

El proveedor entrega por canal seguro:

- Host VC-JWT;
- dominio y MSP solicitados;
- canales solicitados;
- IP fija de salida.

El **administrador de Fabric**, no el proveedor ni el DevOps de la ICA del
espacio de datos, usa la identidad registradora de la ICA de Fabric y ejecuta
el asistente público:

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role authority

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role authority \
  --apply --confirm-request '<request-id-firmado>'
```

Salida hacia el DevOps del host: grant de dos usos para MSP/TLS, grant de un
uso para el cliente GW y cadena TLS pública de la ICA de Fabric. Nunca se
entrega la identidad administradora.

El tiempo predeterminado del asistente es 15 minutos. Para una entrega acordada
de viernes a lunes, el administrador puede generar ambos grants con una ventana
de 72 horas:

```bash
export ENROLLMENT_GRANT_TTL_SECONDS=259200
```

La ventana puede estar entre 60 segundos y 72 horas. Ampliarla no aumenta los
usos: el grant del peer mantiene exactamente dos enrolamientos —MSP y TLS— y
el del cliente GW mantiene uno. `expiresAt` lo comprueban los asistentes; la
ICA de Fabric aplica el límite de usos. Por ello el administrador debe revocar
el identificador si llega el final de la ventana sin haberse consumido.

## 8. DevOps del host: generar MSP/TLS dentro del host

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role host

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role host \
  --apply --confirm-request '<request-id-firmado>'
```

Salida: MSP/TLS del peer, identidad cliente del GW, `gw.fabric.env` y paquete
saneado para Kubernetes. Las claves privadas nunca salen del host.

## 9. DevOps del host: configurar el operador e instalar el chart común

Los values deben contener la identidad legal del operador, su controller
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
```

Al arrancar, GW crea automáticamente el registro técnico reservado `host`,
genera sus claves KMS y publica su DID operativo. Ese registro representa al
operador del servicio; no ocupa ni sustituye el alta posterior de sus tenants.

```bash
helm pull oci://ghcr.io/global-datacare/gdc-host --version 0.3.1

bash scripts/validate-host-helm-values.sh \
  /secure/inventory/host.values.yaml '<namespace>' '<release>'

helm upgrade --install '<release>' oci://ghcr.io/global-datacare/gdc-host \
  --version 0.3.1 --namespace '<namespace>' --create-namespace \
  --values /secure/inventory/host.values.yaml \
  --atomic --wait --timeout 15m
```

Los `values` referencian Secrets ya creados para MSP, TLS, autorización, GW,
PostgreSQL y CouchDB. No contienen claves, grants, VC-JWT ni contraseñas.

## 10. Administrador de Fabric: incorporar el MSP y aceptar el host

El administrador de Fabric aplica el reconciliador con su inventario privado:

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role platform

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role platform \
  --apply --confirm-request '<request-id-firmado>'
```

El DevOps del host y el administrador de Fabric comprueban pods, PVC, peer,
canales, CCAAS, escritura, lectura, denegación, reinicio y restauración. Un pod
en estado `Running` no es una aceptación.

La guía técnica ampliada está en
[`GUIA_OPERATIVA_HOST_ES.md`](./GUIA_OPERATIVA_HOST_ES.md).
