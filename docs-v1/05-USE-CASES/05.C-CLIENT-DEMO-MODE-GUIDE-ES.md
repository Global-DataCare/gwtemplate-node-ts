# Guía de Implementación: Modo DEMO para Clientes

## 1. Visión General

Este documento especifica el protocolo de comunicación con el backend cuando este opera en modo `DEMO`. El objetivo de este modo es permitir el desarrollo y la prueba de los flujos de la aplicación cliente sin requerir la implementación de la criptografía post-cuántica real.

En modo `DEMO`, las operaciones criptográficas (cifrado, firma) se **simulan**. Se deben construir y procesar mensajes con una estructura idéntica a los JWE y JWS de producción, pero el `ciphertext` se reemplaza por el payload codificado en **Base64Url**.

**Nota Importante:** El modo `DEMO` está diseñado exclusivamente para entornos de desarrollo y staging. No debe ni puede ser utilizado en producción.

---

## 2. Flujo de Interacción

El ciclo completo de una petición asíncrona en modo `DEMO` es el siguiente:

1.  **Obtener el `did.json` del Host**: Realizar una petición `GET` al endpoint de descubrimiento del host para obtener su documento DID y, con ello, los identificadores (`kid`) de sus claves públicas simuladas.
2.  **Construir una Petición JWE Simulada**: Anidar un JWS simulado (que contiene el payload) dentro de un JWE compacto simulado.
3.  **Enviar la Petición Asíncrona**: Enviar el JWE simulado a través de una petición `POST` con el `Content-Type` y el cuerpo adecuados.
4.  **Sondear el Resultado**: Utilizar la URL proporcionada en el header `Location` de la respuesta para consultar el estado del trabajo.
5.  **Procesar la Respuesta JWE Simulada**: Al obtener el resultado, "descifrar" el JWE de la respuesta para extraer el payload y "verificar" la firma del host.

---

## 3. Guía Técnica Detallada

### 3.1. Descubrimiento de Claves del Host

Para iniciar una comunicación, es necesario obtener los `kid` (Key ID) del host.

*   **Petición**: `GET /.well-known/did.json` al `API_BASE_URL` del entorno.
*   **Identificador `did:web` del Host**: La estructura del `id` del host varía según el entorno.
    *   **Local**: `did:web:localhost%3A3000`
    *   **Staging (Google Cloud Run)**: `did:web:<service-name>-<project-hash>-<region>.a.run.app` (El `hostname` se codifica con `%3A` si contiene puertos).

**Respuesta `did.json` (Ejemplo de Staging):**
```json
{
    "id": "did:web:gw-staging-abcdef-ew.a.run.app",
    "verificationMethod": [
        {
            "id": "did:web:gw-staging-abcdef-ew.a.run.app#key-pqc-sig-1",
            "type": "JsonWebKey2020",
            "controller": "...",
            "publicKeyJwk": { "kid": "...", "kty": "AKP", "alg": "ML-DSA-44", "pub": "..." }
        },
        {
            "id": "did:web:gw-staging-abcdef-ew.a.run.app#key-pqc-enc-1",
            "type": "JsonWebKey2020",
            "controller": "...",
            "publicKeyJwk": { "kid": "...", "kty": "OKP", "crv": "ML-KEM-768", "x": "..." }
        }
    ,
    "keyAgreement": ["...#key-pqc-enc-1"],
    "assertionMethod": ["...#key-pqc-sig-1"
}
```

**Acción Requerida:**
1.  Almacenar el `kid` de la clave de **cifrado** del host (la que tiene `crv: "ML-KEM-768"` en su `publicKeyJwk`). Se usará en el header del JWE de la petición.
2.  Almacenar el `kid` de la clave de **firma** del host (la que tiene `alg: "ML-DSA-44"`). Se usará para verificar la respuesta.

### 3.2. Simulación de Petición Cifrada (JWE)

La petición debe tener la estructura anidada: `JWE( JWS( Payload ) )`.

#### A. Preparar el Payload
El objeto JSON de la petición de negocio.
```json
{ "thid": "client-thread-123", "type": "...", "body": { ... } }
```

#### B. Simular el JWS Interno (Firma del Cliente)
1.  **Encabezado Protegido del JWS**: Debe contener el `alg` y el `kid` de la clave de firma del **cliente**.
    ```json
    { "alg": "ML-DSA-44", "kid": "did:web:client.com#key-1" }
    ```
2.  **Construcción del JWS Compacto Falso**:
    -   `jws_header_b64` = Base64Url(JSON.stringify(Encabezado JWS))
    -   `payload_b64` = Base64Url(JSON.stringify(Payload))
    -   `fake_signature` = "dev-fake-signature"
    -   `jws_compacto` = `${jws_header_b64}.${payload_b64}.${fake_signature}`

3.  **Envoltura para el Payload del JWE**: El JWS compacto se envuelve en un objeto JSON.
    ```json
    { "jws": "<jws_compacto>" }
    ```

#### C. Simular el JWE Externo (Cifrado para el Servidor)
1.  **Encabezado Protegido del JWE**: Debe contener el `kid` de la clave de cifrado del **servidor** (obtenido en 3.1).
    ```json
    { "alg": "none", "enc": "none", "kid": "did:web:gw-staging...#key-pqc-enc-1" }
    ```
2.  **Construcción del JWE Compacto Final**:
    -   `jwe_header_b64` = Base64Url(JSON.stringify(Encabezado JWE))
    -   `fake_ciphertext_b64` = Base64Url(JSON.stringify(Objeto envoltura del JWS))
    -   `jwe_compacto_final` = `${jwe_header_b64}..dev-iv.${fake_ciphertext_b64}.dev-tag`
    -   **Nota**: La 2ª parte (Encrypted Key) está vacía. La 3ª (IV) y 5ª (Tag) son placeholders fijos.

### 3.3. Envío de la Petición HTTP

La petición HTTP final debe estar formateada de la siguiente manera:

```http
POST /host/cds-xx/v1/test/ping/standard/resource/_batch HTTP/1.1
Host: gw-staging-abcdef-ew.a.run.app
Content-Type: application/x-www-form-urlencoded
Content-Length: <longitud_del_cuerpo>

request=<jwe_compacto_final>
```

### 3.4. Procesamiento de la Respuesta Asíncrona

Tras sondear y recibir una respuesta `200 OK`, el cuerpo será `response=<jwe_respuesta_compacto>`.

#### A. "Descifrar" el JWE de la Respuesta
1.  Obtener el string `jwe_respuesta_compacto`.
2.  Dividir el string por el delimitador `.`. Se obtendrán 5 partes.
3.  La 4ª parte (índice 3) es el "ciphertext" (el payload codificado).
4.  Decodificar esta parte de Base64Url a un string JSON.
5.  Parsear el string para obtener el objeto de la respuesta final.

#### B. "Verificar" la Firma de la Respuesta
1.  La 1ª parte del `jwe_respuesta_compacto` (índice 0) es el encabezado protegido.
2.  Decodificar esta parte de Base64Url a un string JSON y parsearlo.
3.  Extraer la propiedad `skid` (Sender Key ID).
4.  Verificar que el valor de `skid` coincide con el `kid` de la clave de **firma** del host (obtenido en el paso 3.1). Esta comprobación confirma la identidad del remitente.
