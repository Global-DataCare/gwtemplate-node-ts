# Documentación del Espacio de Datos de Salud (Versión Unificada en Español)

## 1. Arquitectura: Visión General

El sistema está diseñado como un **Espacio de Datos de Salud Federado y Centrado en el Individuo**.

Los principios clave de esta arquitectura son:

- **Federación de Datos:** Los datos clínicos (`Source of Truth`) permanecen en el sistema del proveedor que los genera (el "Productor de Datos"). No existe un repositorio centralizado de datos de salud.
- **Índice Centralizado Controlado por el Paciente:** Un proveedor de confianza (el "Agregador de Índice"), designado por el paciente, mantiene un **índice** de los datos del paciente. Este índice no contiene los datos en sí, sino metadatos y punteros (URLs seguras) a la ubicación real de los datos. El recurso FHIR `Composition` se utiliza para modelar este índice.
- **Descubrimiento Descentralizado:** Una red de confianza (Blockchain) actúa como un servicio de descubrimiento, permitiendo a los productores de datos encontrar al agregador de índice designado por un paciente para enviarle notificaciones.
- **Autorización Delegada:** El acceso a los datos se controla mediante un modelo de OAuth 2.0, donde el Agregador de Índice, actuando en nombre del paciente, emite tokens de acceso (Bearer Tokens) con permisos granulares para que otros profesionales puedan acceder a los datos directamente desde los sistemas productores.
- **Interoperabilidad Basada en Estándares:** Toda la comunicación se realiza utilizando estándares abiertos:
  - **FHIR R4** para la modelización de datos y mensajería (`Composition`, `DocumentReference`, `Bundle message`).
  - **OAuth 2.0 / JWT** para la seguridad y el acceso.
  - **DID (Identificadores Descentralizados)** para la identidad de los actores.

---

## 2. Actores del Ecosistema

Los siguientes actores interactúan dentro del espacio de datos:

### Individuo (Paciente o Representante Legal)
El dueño y controlador de los datos. Inicia el proceso otorgando consentimiento y designando a un Agregador de Índice.

### Tenant C (Agregador de Índice)
- Un proveedor de servicios de confianza elegido por el Individuo.
- **Responsabilidades:**
  - Gestionar el recurso `Composition` del Individuo, que actúa como el índice de salud unificado.
  - Proporcionar un endpoint seguro para recibir notificaciones de nuevos datos.
  - Actuar como un **Servidor de Autorización** delegado por el Individuo. Emite Bearer Tokens (JWT) a los profesionales de la salud para que puedan acceder a los datos alojados en otros tenants.

### Tenant D, E, ... (Productores de Datos)
- Cualquier organización que genera datos de salud sobre el Individuo (hospitales, laboratorios, clínicas).
- **Responsabilidades:**
  - Antes de notificar al paciente por medios tradicionales, consultar a la Red de Confianza para ver si el paciente tiene un índice de datos activo.
  - Si es así, enviar una notificación estructurada (FHIR Message) al endpoint del Tenant C.
  - Alojar los datos de salud reales y proporcionar un endpoint FHIR seguro para servirlos cuando se presente un token de acceso válido.

### Profesional de la Salud (Consumidor de Datos)
- Un médico, enfermero u otro profesional que necesita acceder a la historia clínica del paciente.
- **Responsabilidades:**
  - Interactuar con la aplicación del Tenant C (o su propio EMR integrado) para visualizar el índice de salud del paciente.
  - Utilizar los tokens emitidos por Tenant C para recuperar los datos clínicos completos desde los Tenants Productores.

### Red de Confianza (Blockchain)
- La infraestructura descentralizada que aporta confianza y capacidad de descubrimiento.
- **Responsabilidades:**
  - **Mantener un Directorio de Participantes Verificados:** La función principal de la blockchain es alojar un smart contract que actúa como un directorio de todos los tenants (`Agregadores`, `Productores`) autorizados para operar en el espacio de datos. Este registro asocia la identidad canónica de un participante (URN) con su identidad criptográfica (DID) y sus endpoints de servicio.
  - Alojar el smart contract que mapea el identificador de un Individuo con el endpoint de notificación de su Tenant C designado.
  - Proporcionar funciones como `getParticipantDetails(urn)` y `getNotificationEndpoint(individualIdentifier)` para ser consultadas por los participantes.

---

## 3. Flujos de Datos Principales

### Flujo 1: Consentimiento y Activación del Índice

Este flujo describe cómo un Individuo activa su índice de salud unificado y designa a un Agregador (Tenant C).

1.  **Otorgamiento del Consentimiento:** El Individuo debe aceptar los Términos y Condiciones del servicio proporcionado por Tenant C. Este documento legal establece que Tenant C actuará como su agente para recibir notificaciones y delegar permisos de acceso.

2.  **Formalización del Consentimiento:** El consentimiento puede formalizarse de varias maneras:
    *   **Firma Digital:** El Individuo firma digitalmente el PDF de los *Términos y condiciones del servicio* (T&C).
    *   **Firma Manuscrita:** El Individuo firma el documento en persona (por ejemplo, en la recepción de un proveedor de salud, que sería el Tenant C) y un administrativo digitaliza el documento, o bien la persona firma el documento PDF con un certificado digital y lo remite a su proveedor de salud (por ejemplo, vía email).

3.  **Envío del Consentimiento:** El documento firmado (digital o digitalizado) se envía al endpoint de alta de la plataforma (el mismo utilizado para el "customer onboarding"). Puede ser enviado por:
    *   El propio Individuo o su representante legal.
    *   Un administrativo que gestiona el alta en nombre del Individuo.

4.  **Procesamiento y Activación:**
    *   El sistema recibe y valida el documento de consentimiento (T&C).
    *   Se crea (o activa) la cuenta del Individuo en el sistema de Tenant C.
    *   Tenant C crea el recurso `Composition` inicial para el Individuo.
    *   Finalmente, Tenant C invoca el smart contract en la *Red de Confianza* para registrar el endpoint de notificación del Individuo, alojado en su servicio de pasarela para el espacio de datos (Gateway API).

A partir de este momento, el índice del Individuo está activo y cualquier Productor de Datos (*Tenant D o Data Provider*) en la red puede descubrir a dónde debe enviar las notificaciones y las urls para acceso a datos que él provee y custodia.

### Flujo 2: Notificación de Nuevos Datos

Este flujo se activa cuando un Produductor de Datos (Tenant D) genera nueva información clínica sobre un Individuo.

1.  **Generación de Datos:** Tenant D, un hospital, genera un documento para el paciente. El informe se almacena en su sistema y se provee un recurso FHIR mediante una URL de acceso segura y estable.

2.  **Descubrimiento del Endpoint:** El sistema de Tenant D, antes de enviar una notificación por SMS o email para que el paciente conozca la ubicación del nuevo documento (URL), consulta la Red de Confianza.
    *   Llama a la función del smart contract para conocer el proveedor en el que se aloja el *Índice de Datos Unificado del individuo*.
    *   El smart contract devuelve la URL del endpoint de notificaciones registrado por Tenant C para ese Individuo.

3.  **Construcción de la Notificación:** Tenant D construye un `Bundle` de FHIR de tipo `message`.
    *   **Entry 1: `MessageHeader`**:
        - `event`: un código que significa "nuevo-documento-disponible".
        - `source`: la identidad de Tenant D.
        - `destination`: la URL del endpoint de Tenant C.
    *   **Entry 2: `DocumentReference`**:
        - Este es el recurso de metadatos del informe de alta. Crucialmente, **no contiene el informe en sí**.
        - El campo `DocumentReference.content.attachment.url` contiene la URL segura donde el informe real puede ser recuperado desde el sistema de Tenant D.

4.  **Envío de la Notificación:** Tenant D envía este `Bundle` mediante una petición `HTTP POST` al endpoint de Tenant C, que puede estar envuelta en un mensaje DIDComm firmado y cifrado.

5.  **Actualización del Índice:** Tenant C recibe y valida el mensaje. Extrae la información de las URLs de los nuevos datos y sus secciones correspondientes, y actualiza dichas secciones en el Índice de salud unificado del Individuo. Así, el este índice está ahora actualizado en tiempo real.

### Flujo 3: Acceso a Datos Federados

Este flujo describe cómo un profesional de la salud autorizado accede a los datos completos del Individuo.

1.  **Consulta del Índice:** Un médico que trabaja en un servicio de emergencias *Tenant E* utiliza una aplicación para ver el índice de salud unificado del paciente, alojado y servido por Tenant C. El médico ve una entrada para un "Informe del Hospital D" y hace clic para abrirlo.

2.  **Solicitud de Acceso:** La aplicación cliente (en nombre del médico y con el consentimiento del paciente) solicita a Tenant C un token para acceder a ese recurso específico.

3.  **Emisión del Bearer Token:** Tenant C, actuando como Servidor de Autorización delegado, verifica que un empleado de la organización *Tenant E* está autorizado para ver los datos de un paciente. Si la autorización es válida, emite un **JSON Web Token (JWT)** con las siguientes propiedades en el *JWT payload* (`JWT claims`):
    *   `iss` (Issuer): El identificador de Tenant C.
    *   `sub` (Subject): El identificador del Individuo (paciente).
    *   `aud` (Audience): El identificador de **Tenant D**, el dueño del recurso. Esto asegura que el token solo puede ser usado en el sistema de Tenant D.
    *   `scope`: Define el permiso granular. Puede ser:
        - **Específico a un recurso:** por ejemplo, `Patient/DocumentReference.rs?_id=document-123`, alojado y custodiado en el sistema de información de *Tenant D*.
        - **Específico a una sección:** por ejemplo, `Patient/Observation.rs?category=laboratory`, para acceder a todos los resultados de laboratorio alojados y custodiados por *Tenant D* en su propio sistema de información.

4.  **Recuperación del Dato:** La aplicación del médico realiza una petición a la URL del recurso que obtuvo mediante el índice del paciente (incluyendo en la cabecera de la petición HTTP el token firmado por *Tenant C* con los permisos o `scope`). El estándar FHIR permite realizar esta petición tanto con `GET` como con `POST` para búsquedas (`_search`). El método `POST` es preferible por seguridad al evitar que los parámetros de la consulta aparezcan en logs de URL.

    **Ejemplo con `POST` (Recomendado):**
    ```
    POST /fhir/DocumentReference/_search HTTP/1.1
    Host: api-fhir-data-provider.example.com
    Authorization: Bearer <JWT_BY_TENANT_C>
    Content-Type: application/x-www-form-urlencoded

    _id=document-123
    ```

5.  **Validación y Respuesta:** El servidor de Tenant D:
    *   Recibe la petición.
    *   **Verifica la identidad del emisor del token:** Antes de confiar en la firma del JWT, consulta a la Red de Confianza para validar que el `iss` (issuer) del token se corresponde con el DID registrado para ese participante (Tenant C).
    *   Una vez verificada la identidad del emisor, resuelve su DID para obtener la clave pública correcta y valida la firma del JWT.
    *   Verifica que la `aud` (audiencia) se corresponde con él mismo (Tenant D).
    *   Verifica que el `scope` autoriza la acción solicitada.
    *   Si todo es correcto, devuelve la respuesta con los recursos FHIR solicitados, y puede notificar sobre dicho acceso, enviando un mensaje a Tenant C para el individuo.

Este mecanismo garantiza que los datos nunca se entregan desde el sistema del productor y custodio de la información sin una prueba criptográfica de autorización granular y específica, emitida por el agente de confianza del paciente.
