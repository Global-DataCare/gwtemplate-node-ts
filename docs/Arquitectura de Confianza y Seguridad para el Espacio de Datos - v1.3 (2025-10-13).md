# ARQUITECTURA DE CONFIANZA Y SEGURIDAD PARA EL ESPACIO DE DATOS

Para ilustrar cómo se garantiza la identidad y la seguridad en el espacio de datos, se ha diseñado una arquitectura de confianza y soberanía en tres capas conceptuales. A continuación, se presentan los actores y el funcionamiento de cada capa de una forma sencilla:

**1\. Identidad Verificada** (el 'pasaporte'): Se establece quién es cada participante y se le da acceso a la red de confianza.

**2\. Comunicaciones Seguras** (el 'buzón post-cuántico'): Se garantiza que las interacciones entre los participantes sean privadas y auténticas, usando criptografía de nueva generación.

**3\. Soberanía de Datos** (el 'almacén propio'): Se asegura que cada participante tenga el control final sobre sus datos almacenados.

Para visualizar esto, imaginemos el sistema como construir una ciudadela digital segura. El principio fundamental de esta ciudadela es el modelo de seguridad más robusto que existe: una **Arquitectura de Confianza Cero (Zero Trust Architecture - ZTA)**. Este enfoque, **alineado con las directrices de institutos de referencia como el NIST (EE.UU.) y ENISA (UE)**, asume que no se debe confiar en nadie por defecto y que cada interacción debe ser verificada.

## LOS ACTORES (¿QUIÉN ES QUIÉN?)

**1\. Org A (La Gobernadora**): Es la entidad que establece las 'leyes' de la ciudadela. Su máxima responsabilidad es velar por la confianza y el uso ético de los datos.

**2\. Org Z (Zero Trust, la Verificadora)**: Es la entidad que realiza la verificación de las organizaciones que solicitan adhesión al espacio de datos en un sector (socio-sanitario, emergencias, investigación, etc.). En el caso de demostración, este rol de verificación lo asume la Org A, que también gestiona la emisora intermedia de certificados (ICA).

**3\. Host B (Un Constructor de edificios)**: Es una organización de confianza que provee la infraestructura base (los 'edificios') en una región concreta, para que otras organizaciones puedan establecerse. En el caso de demostración, también es Org A en su rol de proveedor de servicios API éticos, seguros y confiables.

**4\. Org C (El Inquilino o cliente)**: Es una de las organizaciones (por ejemplo: clínica, laboratorio, residencia de ancianos, empresa de IA) que 'alquila un piso' en uno de los edificios que el Host B dispone, para operar en el espacio de datos.

## PARTE 1: EL SISTEMA DE "PASAPORTES DIGITALES" (VERIFICACIÓN DE IDENTIDAD)

Antes de que nadie pueda entrar en la ciudadela (la red blockchain), necesita un pasaporte digital de alta seguridad que demuestre quién es. Este sistema es jerárquico, como en el mundo real.

**1\. La Autoridad Raíz (Root CA)**: La Org A actúa como el 'Gobierno' que emite los pasaportes. Crea un certificado maestro, que es la máxima prueba de confianza. Por seguridad, esta autoridad está guardada bajo llave y desconectada.

**2\. La Oficina de Pasaportes (ICA, Intermediate CA)**: La Root CA delega la tarea de emitir pasaportes del día a día en una 'oficina de pasaportes'. Esta oficina (ICA) tiene un certificado firmado por la autoridad raíz, lo que demuestra que está autorizada. En la demo, esta oficina también la gestiona Org A.

**3\. Obtención del Pasaporte**: Cuando el Host B o un Inquilino (Org C) quieren unirse, deben solicitar su pasaporte a la ICA. Para ello, deben pasar un proceso de verificación de identidad riguroso (en la demo, se hace firmando los términos y condiciones con un certificado de representante legal). Una vez verificado, la ICA les entrega su 'pasaporte': un certificado digital privado que les da acceso a la red de blockchain.

Resultado de la Parte 1: Todos los participantes tienen una identidad digital verificada y confiable, y solo ellos pueden operar en la red.

## PARTE 2: EL SISTEMA DE "BUZONES SEGUROS" PARA COMUNICACIONES RESISTENTES A MALWARE Y ORDENADORES CUÁNTICOS

Ahora que todos están dentro de la ciudadela con su pasaporte, necesitan una forma de enviarse mensajes y datos de forma 100 % privada y segura, incluso contra los ataques en dispositivos infectados con malware o de los futuros ordenadores cuánticos, para evitar que los atacantes puedan espiar datos ahora y descifrarlos dentro de unos años.

**1\. Creación Descentralizada**: Cada participante genera su propio juego de llaves (pública y privada) utilizando criptografía resistente a la computación cuántica.

**2\. Registro en Blockchain**: Cada participante registra la huella digital (hash) de sus claves en la red blockchain (su identidad digital criptográfica), tras la verificación realizada de la organización que utiliza como pasarela.

**3\. Usuarios Finales**: Profesionales y pacientes tienen sus propias llaves asociadas a sus identificadores y roles.

### La Blockchain como Registro de Confianza del Espacio de Datos

La blockchain actúa como el **registro inmutable y verificable de todos los participantes y artefactos de confianza** del espacio de datos.

No se utiliza únicamente para almacenar huellas de la identidad digital (claves criptográficas públicas) y su trazabilidad (cuándo se reemplazan por otras), sino como el **directorio de referencia** donde quedan ancladas también las evidencias de identidad (cómo se verificó la identidad real), autorización (consentimientos) y trazabilidad de cada organización verificada (dominio principal y credenciales verificables activas en cada momento).

El proceso funciona del siguiente modo:

- Cuando una organización firma los Términos y Condiciones y supera el proceso de verificación, la **Autoridad Intermedia (ICA)** registra en blockchain su identidad pública y sus artefactos asociados.  

- Este registro incluye, como mínimo:  
  - El **identificador canónico (URN)** de la organización.  

  - Su **identificador did:web** (dominio principal).  

  - Los **endpoints de sus servicios**, conforme al estándar SMART on FHIR.  

  - El **hash verificable** de los Términos y Condiciones aceptados.  

  - Los **hashes de las imágenes Docker** utilizadas para su infraestructura autorizada.  

  - Los **hashes de las claves criptográficas** y certificados X.509 emitidos.  

  - El **hash de la Self-Description**, que actúa como su carta de presentación dentro del espacio de datos.  

- Una vez publicado, el registro on-chain puede consultarse mediante funciones de lectura en los smart-contracts, que devuelven la información verificada de cada organización.  

- Este mecanismo garantiza que cualquier entidad que participe en una transacción dentro del espacio de datos pueda **verificar de forma descentralizada** la legitimidad de la otra parte antes de intercambiar datos o validar una firma.

En la práctica, la blockchain se convierte así en el **ancla de confianza del espacio de datos**, proporcionando un mecanismo descentralizado de **resolución de identidades, validación de artefactos y trazabilidad técnica**, sin depender de un servicio centralizado de gestión o repositorio de confianza.

### Proceso de verificación escalonado

La incorporación de una nueva organización al espacio de datos se realiza mediante un proceso de verificación en dos niveles:

- **Verificación inicial por el Host**: el Host actúa como pasarela de confianza y valida la autenticidad de la **firma digital del representante legal**, así como la **aceptación firmada de los Términos y Condiciones**. Con esta información, puede **registrar automáticamente el hash de dicha aceptación en la blockchain** y la organización puede obtener un **certificado de acceso a la red de pruebas (test-network)**.  

- **Verificación avanzada por la Autoridad Intermedia (ICA)**: una vez completado el alta técnica, la ICA confirma la información institucional (dirección postal, registro sanitario, licencias, etc.) y actualiza el registro on-chain de la organización, consolidando su identidad verificada dentro del espacio de datos.

Este esquema federado permite un equilibrio entre agilidad operativa y garantía institucional, asegurando que la confianza se refuerza progresivamente sin depender de un único punto de validación.

## PARTE 3: SOBERANÍA DE DATOS (EL ALMACÉN PROPIO)

Una vez que tenemos identidades verificadas y comunicaciones seguras, el tercer pilar es garantizar que cada participante tenga el control absoluto sobre sus datos, tanto la información pública que comparte como los datos privados que almacena.

### La "Guía Telefónica" Pública: Publicando la Identidad Soberana

Cada participante publica su información criptográfica verificable (certificados, claves públicas, etc.) en la carpeta estándar **/.well-known**, como si fuera una guía telefónica digital.

Ejemplos:

\- El Host: [host.example.com/.well-known](http://host.example.com/.well-known)

\- Un Inquilino (ACME): La organización "ACME" opera dentro del host, pero puede usar su propio dominio. Su "guía telefónica" podría estar en [host.example.com/acme/.../.well-known](http://host.example.com/acme/.../.well-known), pero ser accesible públicamente a través de su dominio principal [api.acme.org/.well-known](http://api.acme.org/.well-known). Esto se logra con una simple configuración de dominios.

\- Un Empleado: Las claves públicas de un profesional (empleado) en ACME con rol de médico generalista (categoría profesional 2211, según la clasificación internacional ISCO-08) se encontrarían en: [api.acme.org/employee/email/professional1@acme.org/role/isco-08/2211/.well-known](http://api.acme.org/employee/email/professional1@acme.org/role/isco-08/2211/.well-known)

\- Un Individuo: Las claves de un paciente con identificador za1B2c... se encontrarían en: [api.acme.org/individual/multibase/za1B2c.../.well-known](http://api.acme.org/individual/multibase/za1B2c.../.well-known)

### La Bóveda Privada: Protegiendo los Datos Soberanos

Si la 'Guía Telefónica' es la cara pública de la soberanía, la 'Bóveda' es su núcleo privado. Es donde se protegen los datos sensibles con múltiples capas de seguridad y control.

### Estructura de la jerarquía de cifrado

**Cada dato individual** (empleado, individuo, identidad legal asociada, contactos de emergencia, etc.) **se cifra con una Content Encryption Key (CEK) única**, generada aleatoriamente. Esto garantiza la confidencialidad de cada registro y minimiza el impacto en caso de una posible brecha.

**La CEK está cifrada ('envuelta') con la Data Encryption Key (DEK) del Inquilino** (Org C). Esto permite al Inquilino descifrar sus propios datos sin depender de terceros. Además, la DEK puede rotarse en cualquier momento por los controladores designados del Inquilino, garantizando un control total sobre el ciclo de vida de las claves.

**La DEK del Inquilino está cifrada con la Data Encryption Key del Host**, que protege la configuración del Inquilino o tenant dentro de la base de datos del Host. Este nivel adicional habilita la recuperación segura de identidades digitales e índices de datos en caso de desastre o pérdida de claves locales por parte del Inquilino.

**La DEK del Host (su clave de datos) está, a su vez, protegida por una Key Encryption Key (KEK)** o **'llave maestra', gestionada por un Módulo de Seguridad por Software (KMS)**. Para maximizar la seguridad, esta KEK no se almacena directamente: se reconstruye de forma segura en memoria cada vez que el servicio se inicia, utilizando un secreto de arranque (seed). Inmediatamente después, el material de arranque se elimina de la memoria y la KEK queda protegida por una clave de sesión única, asegurando que ninguna clave maestra pueda ser extraída del servicio mientras está en funcionamiento.

Este esquema jerárquico garantiza la soberanía completa del Inquilino sobre sus datos, el cumplimiento del RGPD, y la alineación con las directrices de seguridad de NIST SP 800-57 para la **gestión de claves criptográficas en entornos distribuidos**.

## PARTE 4: Flujos de Datos Principales

### Flujo 1: Consentimiento y Activación del Índice de Datos

Este flujo describe cómo un Individuo activa su índice de salud unificado y designa a un Agregador (Tenant C).

- Otorgamiento del Consentimiento: El Individuo debe aceptar los Términos y Condiciones del servicio proporcionado por Tenant C. Este documento legal establece que Tenant C actuará como su agente para recibir notificaciones y delegar permisos de acceso.
- Formalización del Consentimiento: El consentimiento puede formalizarse de varias maneras:
  - Firma Digital: El Individuo firma digitalmente el PDF de los Términos y condiciones del servicio (T&C).
  - Firma Manuscrita: El Individuo firma el documento en persona (por ejemplo, en la recepción de un proveedor de salud, que sería el Tenant C) y un administrativo digitaliza el documento, o bien la persona firma el documento PDF con un certificado digital y lo remite a su proveedor de salud (por ejemplo, vía email).
- Envío del Consentimiento: El documento firmado (digital o digitalizado) se envía al endpoint de alta de la plataforma (el mismo utilizado para el "customer onboarding"). Puede ser enviado por:
  - El propio Individuo o su representante legal.
  - Un administrativo que gestiona el alta en nombre del Individuo.
- Procesamiento y Activación:
  - El sistema recibe y valida el documento de consentimiento (T&C).
  - Se crea (o activa) la cuenta del Individuo en el sistema de Tenant C, que incluye su Identificador de Salud Unificado y el Índice de Datos de Salud Unificado.
  - Finalmente, Tenant C invoca el smart contract en la Red de Confianza para registrar el endpoint de notificación del Individuo, alojado en su servicio (Gateway API).

A partir de este momento, el índice del Individuo está activo y cualquier Productor de Datos (Tenant D o Data Provider) en la red puede descubrir a dónde debe enviar las notificaciones y las URLs para acceso a datos que él provee y custodia.

### Flujo 2: Notificación de Nuevos Datos

Este flujo se activa cuando un Productor de Datos (Tenant D) genera nueva información sobre un Individuo.

- Generación de Datos: Tenant D genera un documento para un individuo. El informe se almacena en su sistema interno y se provee un recurso FHIR estándar, mediante una URL de acceso segura y estable.
- Descubrimiento del Endpoint: El sistema de Tenant D, antes de enviar una notificación por SMS o email para que el individuo o sus tutores legales conozcan la ubicación del nuevo documento (URL), consulta la Red de Confianza.
  - Llama a la función del smart contract para conocer el proveedor en el que se aloja el Índice de Datos Unificado del individuo.
  - El smart contract devuelve la URL del endpoint de notificaciones para ese Individuo, que fue registrado por Tenant C.
- Construcción de la Notificación: Tenant D construye un documento (Bundle) que incluye un índice estandarizado con las secciones y URLs de documentos en cada sección.
- Envío de la Notificación: Tenant D envía este documento en un mensaje, mediante una petición HTTP POST al endpoint de Tenant C. Este documento puede estar envuelto en un mensaje DIDComm firmado y cifrado mediante algoritmos post-cuánticos.
- Actualización del Índice: Tenant C recibe y valida el mensaje. Extrae la información de las URLs de los nuevos datos y sus secciones correspondientes, y actualiza dichas secciones en el Índice de salud unificado del Individuo. Así, el Índice de Datos Unificados del individuo se encuentra actualizado en tiempo real.

### Flujo 3: Acceso Federado

Este flujo describe cómo un profesional autorizado accede a los datos del Individuo.

- Consulta del Índice: Un médico que trabaja en un servicio de emergencias ("Tenant E") utiliza una aplicación para ver el índice de salud unificado del paciente, alojado y servido por "Tenant C". El médico ve una entrada para un "Informe del Hospital D" y hace clic para abrirlo.
- Solicitud de Acceso: La aplicación cliente solicita a Tenant C un token para acceder a ese recurso específico (en nombre del médico y con el consentimiento del paciente).
- Emisión del Bearer Token: Tenant C, actuando como Servidor de Autorización delegado, verifica que el empleado concreto de la organización Tenant E está autorizado para ver determinados datos de un paciente. Si la autorización es válida, emite un JSON Web Token (JWT) con las siguientes propiedades en el JWT payload (JWT claims):
  - iss (Issuer): El identificador de Tenant C.
  - sub (Subject): El identificador del Individuo (paciente).
  - aud (Audience): El identificador de Tenant D, el dueño del recurso. Esto asegura que el token solo puede ser usado en el sistema de Tenant D.
  - scope: Define el permiso granular. Puede ser específico a un recurso o a una sección, por ejemplo, para acceder a todos los resultados de laboratorio alojados y custodiados por Tenant D en su propio sistema de información.
- Recuperación del Dato: La aplicación del médico realiza una petición a la URL del recurso que obtuvo mediante el índice del paciente (incluyendo en la cabecera de la petición HTTP el token firmado por Tenant C con los permisos o scope). El estándar FHIR permite realizar esta petición tanto con GET como con POST para búsquedas (\_search). El método POST es preferible por seguridad al evitar que los parámetros de la consulta aparezcan en logs de URL.

Ejemplo con POST (Recomendado):

  
POST /fhir/DocumentReference/\_search HTTP/1.1

Host: api-fhir-data-provider.example.com

Authorization: Bearer &lt;JWT_BY_TENANT_C&gt;

Content-Type: application/x-www-form-urlencoded

\_id=document-123

- Validación y Respuesta:

El servidor de Tenant D:

- - Recibe la petición.
    - Verifica la identidad del emisor del token: Antes de confiar en la firma del JWT, consulta a la Red de Confianza para validar que el iss (issuer) del token se corresponde con el DID registrado para ese participante (Tenant C).
    - Una vez verificada la identidad del emisor, resuelve su DID para obtener la clave pública correcta y valida la firma del JWT.
    - Verifica que la aud (audiencia) se corresponde con él mismo (Tenant D).
    - Verifica que el scope autoriza la acción solicitada.
    - Si todo es correcto, devuelve la respuesta con los recursos FHIR solicitados a Tenant D, que pueden estar envueltos en un mensaje cifrado para el empleado que los pidió. También puede notificar sobre dicho acceso a Tenant C, enviando un mensaje para el individuo, y que puede añadirse al registro de auditoría de accesos en el Índice de Datos Unificados del individuo.

Este mecanismo garantiza que los datos nunca se entregan desde el sistema del productor y custodio de la información sin una prueba criptográfica de autorización granular y específica, emitida por el agente de confianza del paciente.