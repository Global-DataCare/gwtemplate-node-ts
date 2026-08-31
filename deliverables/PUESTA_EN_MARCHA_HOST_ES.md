# Puesta en marcha de un host: test-network y producción

Esta guía comienza cuando la ICA del espacio de datos ya está operativa. No
migra staging a producción: crea identidades, certificados, Secrets y PVC
nuevos para cada red.

## 1. Hoja de entrada

El proveedor no ejecuta nada hasta recibir estos valores:

```text
Entorno: test-network | network
Dominio HTTPS del host:
URL de la ICA del espacio de datos:
Jurisdicción:
Sector:
Razón social del proveedor:
VAT/TAX/identificador oficial:
País:
Email del controller del host:
MSP ID solicitado:
Canales solicitados:
IP fija de salida hacia la ICA de Fabric:
Namespace y release Helm:
StorageClass e IngressClass:
DNS/TLS del GW y del peer:
```

La autoridad confirma por escrito dominio, red, controller, identidad legal,
MSP y canales. En `test-network` se usa una autorización de staging; para
`network` se repite todo con una autorización productiva nueva.

## 2. Preparar el checkout y el inventario privado

```bash
git clone https://github.com/Global-DataCare/gwtemplate-node-ts.git
cd gwtemplate-node-ts
npm ci

install -d -m 700 /secure/host/bootstrap /secure/onboarding /secure/inventory
cp configs/host-credential-request.example.json \
  /secure/onboarding/host-credential-request.json
chmod 600 /secure/onboarding/host-credential-request.json
```

Edite únicamente la copia privada y complete todos los campos. Para producción
cambie `networkKind` a `network`, el dominio y la URL `_verify`; no reutilice la
clave ni la VC de `test-network`.

## 3. Generar la identidad de bootstrap del host

```bash
node scripts/onboarding/request-host-credential.mjs \
  --manifest /secure/onboarding/host-credential-request.json --init
```

Salida:

- `host-signing.private.jwk.json`: permanece en el host, modo `0600`;
- `did.json`: solo material público; se entrega a la autoridad.

La autoridad monta ese `did.json` en la ICA del espacio de datos y configura
el dominio y la red exactos:

```dotenv
ICA_PREAUTHORIZED_HOST_DOMAINS=<dominio-exacto>
ICA_PREAUTHORIZED_HOST_NETWORK_KINDS=test-network
ICA_PREAUTHORIZED_HOST_DID_DOCUMENTS_FILE=/etc/ica/approved-hosts/did-documents.json
```

Para producción se usa `network`. No mezcle en el mismo perfil una lista de
dominios de staging y producción: dominio y red deben revisarse como una sola
decisión de gobernanza.

## 4. Solicitar la HostingServiceCredential

Cuando la autoridad confirme que la ICA ha cargado la preautorización:

```bash
node scripts/onboarding/request-host-credential.mjs \
  --manifest /secure/onboarding/host-credential-request.json --request
```

El asistente firma y envía la solicitud, espera el resultado y guarda
`host-credential.json` con la VC JSON y la VC-JWT. El operador no necesita
construir JWS, claims ni llamadas HTTP manualmente.

No continúe si la credencial no contiene `HostingServiceCredential`, si su
sujeto no es la URL exacta del host o si el controller/identidad legal no
coinciden con la aprobación.

## 5. Solicitar el alta en Fabric

El proveedor entrega por canal seguro:

- Host VC-JWT;
- dominio y MSP solicitados;
- DID público;
- canales solicitados;
- IP fija de salida.

La autoridad, no el proveedor, usa la identidad administradora de la ICA de
Fabric y ejecuta el asistente público:

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role authority

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role authority \
  --apply --confirm-request '<request-id-firmado>'
```

Salida hacia el proveedor: grant de dos usos para MSP/TLS, grant de un uso para
el cliente GW y cadena TLS pública de la ICA de Fabric. Nunca se entrega la
identidad administradora.

## 6. Generar MSP/TLS dentro del host

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role host

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role host \
  --apply --confirm-request '<request-id-firmado>'
```

Salida: MSP/TLS del peer, identidad cliente del GW, `gw.fabric.env` y paquete
saneado para Kubernetes. Las claves privadas nunca salen del host.

## 7. Instalar el chart común

```bash
helm pull oci://ghcr.io/global-datacare/gdc-host --version 0.3.0

bash scripts/validate-host-helm-values.sh \
  /secure/inventory/host.values.yaml '<namespace>' '<release>'

helm upgrade --install '<release>' oci://ghcr.io/global-datacare/gdc-host \
  --version 0.3.0 --namespace '<namespace>' --create-namespace \
  --values /secure/inventory/host.values.yaml \
  --atomic --wait --timeout 15m
```

Los `values` referencian Secrets ya creados para MSP, TLS, autorización, GW,
PostgreSQL y CouchDB. No contienen claves, grants, VC-JWT ni contraseñas.

## 8. Incorporar el MSP y aceptar el host

La autoridad aplica el reconciliador con su inventario privado:

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role platform

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role platform \
  --apply --confirm-request '<request-id-firmado>'
```

El proveedor y la autoridad comprueban pods, PVC, peer, canales, CCAAS,
escritura, lectura, denegación, reinicio y restauración. Un pod en estado
`Running` no es una aceptación.

La guía técnica ampliada está en
[`GUIA_OPERATIVA_HOST_ES.md`](./GUIA_OPERATIVA_HOST_ES.md).
