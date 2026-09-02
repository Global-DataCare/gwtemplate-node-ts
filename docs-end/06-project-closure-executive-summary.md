# Memoria de Proyecto

Estado: versión resumida en español, orientada a conversión posterior a Word/PDF.

## 1. Resumen Ejecutivo

El proyecto ha tenido como finalidad construir y consolidar una plataforma de
interoperabilidad y gobierno de identidades digitales capaz de soportar el
onboarding de organizaciones, profesionales e individuos, la gestión de
permisos, el acceso clínico seguro y la publicación de evidencias digitales en
un entorno reproducible.

La solución resultante combina:

- una capa backend de registro, activación, indexación y búsqueda
- una capa de contratos y utilidades compartidas
- SDKs de integración para backend y frontend
- una arquitectura de identidad y confianza basada en DID, VC y publicación
  `.well-known`
- una base local reproducible con trust bundle, ICA, GW CORE y Fabric

Desde el punto de vista del cierre de proyecto, el resultado principal es que
la plataforma ya no depende de conocimiento interno disperso, sino que dispone
de una arquitectura explicable, modular, documentada y ejecutable.

## 2. Objetivo General

El objetivo general del proyecto ha sido proporcionar una base técnica
integrable para un espacio de datos con foco en:

- alta y activación de organizaciones legales
- recuperación y rotación del controller de organización
- ciclo de vida de empleados y profesionales
- ciclo de vida de individuos
- concesión y revocación de permisos
- ingestión clínica y generación de gemelo digital
- búsqueda de composiciones y bundles IPS
- publicación y resolución de identidad digital
- interoperabilidad segura sobre FHIR, DID y VC

Adicionalmente, se ha perseguido que esta base sea:

- modular
- extensible
- reproducible localmente
- compatible con distintos modos de transporte
- adecuada para escenarios de auditoría, integración y demostración

## 3. Justificación de la Arquitectura

La arquitectura adoptada responde a la necesidad de separar claramente
responsabilidades funcionales, tecnológicas y operativas.

### 3.1 Separación por capas

El sistema se distribuye en varias capas:

| Capa | Función principal |
| --- | --- |
| `gdc-common-utils-ts` | constantes, contratos compartidos, editores, lectores, ejemplos y utilidades reutilizables |
| `gdc-sdk-core-ts` | contratos de integración, builders y readers neutrales al runtime |
| `gdc-sdk-node-ts` | ejecución backend/BFF, actor SDKs, submit/poll y pruebas live |
| `gdc-sdk-front-ts` | sesiones frontend, acceso a actores y consumo desde cliente |
| `gwtemplate-node-ts` | implementación de GW CORE, managers, rutas, OpenAPI y bootstrap local |
| `ica-client-sdk-ts` | utilidades específicas de integración con ICA |
| `dataspace-ica-ts` | runtime de ICA y publicación de materiales de confianza |

Esta separación permite que:

- la lógica de negocio no quede atrapada en un único backend
- los SDKs no dupliquen parsing ni contratos
- la documentación sea coherente entre backend y cliente
- cada capa sea verificable de forma independiente

### 3.2 Diseño modular

La modularidad ha sido una exigencia clave porque el sistema debe soportar
distintos tipos de actor, distintas rutas de onboarding y distintas políticas
de despliegue.

Por ello se ha trabajado para que:

- los managers del backend orquesten, pero no monopolicen toda la lógica
- la lectura de claims y credenciales esté desacoplada de cada test o endpoint
- los SDKs expongan superficies por actor, no por plumbing interno
- la infraestructura local y la lógica funcional puedan validarse por separado

Este diseño modular facilita tanto el mantenimiento como la evolución futura
hacia productos o canales específicos sin contaminar el núcleo del sistema.

## 4. Funcionalidades Principales Cubiertas

### 4.1 Onboarding de organización legal

La plataforma soporta el ciclo completo de una organización legal:

1. preparación y envío de PDF firmado y datos de verificación
2. verificación legal a través de ICA
3. recepción de credenciales verificadas
4. obtención del `OfferId`
5. confirmación comercial mediante `Order`
6. alta operativa del tenant
7. publicación de identidad y artefactos públicos
8. recuperación o reemisión del controller cuando sea necesario

Este flujo existe en modo canónico y también mantiene compatibilidad con el
camino legacy cuando es necesario interoperar con despliegues anteriores.

### 4.2 Ciclo de vida de empleados y profesionales

El sistema soporta:

- creación de empleados y profesionales
- asignación o reutilización de licencias
- emisión de activation codes
- registro de device/profile
- solicitud de SMART access token
- disable y purge del empleado

Se ha reforzado especialmente el caso de sustitución de dispositivo, de forma
que el mismo profesional pueda reutilizar la misma licencia sin necesidad de
simular una nueva compra.

### 4.3 Ciclo de vida de individuos

El sistema soporta:

- bootstrap del espacio individual
- confirmación comercial cuando procede
- ingestión de datos clínicos y no clínicos
- generación del gemelo digital
- otorgamiento de permisos a profesionales
- acceso clínico autorizado
- disable y purge del espacio individual

### 4.4 Permisos y acceso clínico

La arquitectura funcional obliga a respetar el orden correcto:

1. existencia del individuo
2. carga o disponibilidad de datos
3. concesión de permiso
4. obtención del token de acceso
5. lectura de información autorizada

Esto es especialmente relevante para justificar la seguridad y trazabilidad del
acceso a información clínica.

### 4.5 Gemelo digital e IPS

El proyecto soporta la ingestión de recursos FHIR y bundles IPS, su
indexación y la posterior búsqueda de proyecciones clínicas, incluyendo:

- búsqueda de `Composition`
- obtención del IPS más reciente
- recuperación selectiva por secciones
- alimentación de gemelo digital a partir de datos del sujeto

Además, durante el cierre ha quedado mejor fijado y explicable el flujo entre
frontend, BFF, `profile/wallet`, gateway y gemelo digital:

- el frontend construye el `Bundle` del usuario gestionado mediante editores
  compartidos
- el BFF prepara la `Communication` adecuada según rol y caso de uso
- el backend de `profile/wallet` recibe el payload del usuario autenticado y
  lo encapsula como mensaje seguro DIDComm
- el GW recibe, procesa y responde
- la respuesta vuelve al frontend como `Bundle` reutilizable por la capa común
  de readers
- a partir de ahí, la búsqueda y lectura de gemelo digital e IPS quedan
  conectadas con la misma narrativa funcional

## 5. Seguridad y Modelo de Confianza

La seguridad del sistema se apoya en varias piezas complementarias.

### 5.1 Identidad digital y publicación de confianza

Cada entidad relevante puede publicar artefactos como:

- `did.json`
- `jwks.json`
- `x509.der`
- `legal-participant.vc.json`

Esto permite:

- resolución pública de identidad
- descubrimiento de claves
- publicación de credenciales verificables
- trazabilidad de la cadena de confianza

### 5.2 ICA, VC y binding del controller

El onboarding de organización legal se apoya en ICA para:

- verificar el PDF firmado
- devolver credenciales de organización y representante legal
- proyectar elementos como `sameAs` y `hasCredential.material`

Posteriormente, el sistema reutiliza esa información para:

- enlazar el controller con la organización
- conservar continuidad de identidad
- soportar reissue y recuperación

### 5.3 SMART access token

El acceso clínico no se modela como una simple lectura de base de datos, sino
como una secuencia segura:

- concesión previa de permiso
- solicitud de SMART access token
- lectura del recurso o bundle clínico autorizado

Esto deja una separación clara entre gestión de identidad, autorización y
consumo de información clínica.

Adicionalmente, para escenarios inter-organización ya queda fijado el modelo
de cierre:

- si el actor pertenece al mismo tenant que emite el token, aplica el flujo
  habitual de consentimiento/autorización
- si el actor pertenece a otro tenant, el gateway exige además una prueba de
  acceso inter-tenant válida en ese caso de uso concreto de `research access`
  - en el perfil interno actual, esa prueba es una VP que transporta una VC de
    contrato inter-tenant activa
  - en un perfil externo de investigación, esa misma función puede quedar
    sustituida por un `Bearer data access token` externo ya validado

Esa VC contiene como `credentialSubject` un recurso FHIR `Contract`, mientras
que las firmas de los controllers viven en `proof[]`. De esta forma, la
credencial verificable actúa como contenedor jurídico y criptográfico, y FHIR
mantiene el recurso interoperable del acuerdo.

También queda cerrado que:

- el PDF principal del acuerdo firmado se representa mediante
  `Contract.instantiatesUri`
- la factura o anexos no forman parte del mínimo obligatorio y, si existen,
  quedan como soporte documental adicional

Desde el punto de vista de producto y de futura adopción por integradores,
también queda cerrado el naming de las dos superficies de alto nivel que deben
enseñarse en la documentación 101:

- `OrganizationControllerSdk`
- `DigitalTwinSdk`

La primera agrupa el gobierno del acuerdo y de las autorizaciones. La segunda
agrupa la solicitud del SMART token, la búsqueda de gemelos digitales y la
lectura o descarga de IPS.

Esto permite explicar el caso de uso de forma comprensible para desarrolladores
junior:

1. una organización proveedora como `acme` publica y gobierna sus datos
2. una organización consumidora como `lab` firma el acuerdo inter-tenant
3. el investigador presenta la prueba de acceso exigida por el perfil activo
   - VP con VC de contrato en el perfil interno actual
   - o token externo validado en un perfil de investigación integrado
4. el gateway emite el SMART token si contrato, purpose, capability y políticas
   coinciden
5. con ese token, `DigitalTwinSdk` busca composiciones/gemelos digitales y
   abre o descarga los IPS resultantes

La validación de cierre ya deja probado, además, un caso didáctico concreto:

- `Doraemon` con un IPS importado
- `Novita` con dos medicaciones demo (`ibuprofen` y `paracetamol`)
- búsquedas por `ibuprofen` o `paracetamol` que devuelven exactamente un único
  digital twin, correspondiente a `Novita`

Por tanto, la justificación puede afirmar con precisión que:

- el backend GW y su contrato de rutas para research access quedan cerrados
- el flujo funcional de prueba inter-tenant -> SMART token -> búsqueda de twin
  queda probado en su perfil interno actual
- la futura convergencia pública en `sdk-node` y `sdk-front` es principalmente
  una tarea de empaquetado documental y de fachada, no un vacío del modelo
  backend ya validado

En este punto conviene distinguir entre:

- el perfil interno ya probado, donde la prueba de acceso viaja como `vp_token`
  con la VC de contrato inter-tenant
- y un perfil externo de investigación, por ejemplo con `data access token`
  validado desde Pontus-X, cuyo encaje debe tratarse como una variante acotada
  al endpoint `identity/openid/smart/token` del caso de uso `research access`,
  no como una regla general del resto de usos de `OpenIdAuthManager`

### 5.4 Soporte para criptografía moderna y evolución post-quantum

La plataforma ya contempla una separación explícita entre:

- claves de firma de credenciales
- claves técnicas de transporte
- claves de mensajería
- claves operativas de Fabric

Además, la documentación y los artefactos ya preparan el terreno para una
evolución compatible con mecanismos post-quantum en las capas donde
corresponda, sin mezclar esa preocupación con la lógica de negocio.

## 6. Compatibilidad e Interoperabilidad

Uno de los pilares del proyecto ha sido no sacrificar interoperabilidad a
cambio de pureza teórica.

### 6.1 Adaptación a FHIR

El sistema soporta recursos y bundles compatibles con FHIR, manteniendo la
capacidad de:

- ingerir información clínica
- indexarla
- reconstruir proyecciones reutilizables
- servir búsquedas y lecturas posteriores

### 6.2 Compatibilidad legacy

Se mantiene compatibilidad con caminos legacy cuando es necesario, en
particular:

- flujos legacy de activación
- ciertos formatos de claims contextualizados
- modos de seguridad y transporte de compatibilidad

La compatibilidad no se presenta como el flujo ideal, pero sí como una
capacidad necesaria para convivir con integraciones y entornos previos.

### 6.3 Transporte HTTP, FHIR y DIDComm

La solución deja separados:

- el ciclo de negocio
- el payload funcional
- el envelope de transporte

Esto permite explicar y soportar escenarios como:

- `application/json`
- `application/fhir+json` en modo de compatibilidad
- `application/didcomm-plain+json`
- evolución futura hacia envelopes más seguros o cifrados

Con ello, el sistema puede adaptarse a distintos escenarios de interoperación
sin confundir el contrato funcional con el formato de red.

En términos más cercanos a integradores y equipos de portal/BFF, esto significa
que:

- una cosa es el payload funcional que el usuario o el profesional quiere
  enviar o leer
- otra es la `Communication` FHIR que hace de shell interoperable
- y otra distinta es el envelope DIDComm que protege el transporte entre capas

Esta separación también deja preparado el camino para evolución de
criptografía moderna y mecanismos post-quantum sin reescribir la lógica de
negocio.

## 7. Descubrimiento en el Espacio de Datos

El proyecto contempla explícitamente el descubrimiento como capacidad
arquitectónica, no como detalle accesorio.

Esto incluye:

- publicación de `did.json`
- publicación de credenciales legales
- resolución de DIDs de host, tenant, empleado e individuo
- separación entre identidad pública y rutas internas del backend
- soporte para autodiscovery y para flujos guiados por portal/BFF
- posibilidad de extender la confianza a emisores externos de tokens o
  contratos de servicio, resolviendo sus claves públicas desde DID/JWKS
  configurables por entorno

Esta parte es clave para un espacio de datos real, porque permite desacoplar
la identidad pública de la topología interna de despliegue.

## 8. Reproducibilidad Local

Un elemento esencial del proyecto es la posibilidad de reproducir el sistema
localmente con una base técnica auditable.

La reproducibilidad local cubre:

- generación de Root CA, ICA, host y miembro
- bundle de confianza
- publicación de artefactos `.well-known`
- bootstrap de entorno local Fabric
- arranque de GW CORE
- ejecución de casos de uso live desde los SDKs

Esto aporta varias ventajas:

- validación independiente de cloud o staging
- demostración funcional en entorno controlado
- soporte a auditoría
- mejor transferencia a nuevos desarrolladores

## 9. Casos de Uso Validados

A efectos de cierre, el proyecto deja cubiertos y explicables los siguientes
casos de uso principales:

| Caso de uso | Estado funcional |
| --- | --- |
| onboarding de organización legal | cubierto |
| activación y continuidad de tenant | cubierto |
| recuperación del controller de organización | cubierto |
| alta y gestión de empleados | cubierto |
| registro de device/profile profesional | cubierto |
| bootstrap individual | cubierto |
| ingestión de datos clínicos | cubierto |
| generación de gemelo digital | cubierto |
| concesión y revocación de permisos | cubierto |
| acceso clínico vía SMART token | cubierto |
| búsqueda de composiciones e IPS | cubierto |
| publicación de identidad y trust material | cubierto |
| despliegue local reproducible con Fabric | cubierto |

## 10. Evidencias de Validación

La solidez del cierre no descansa en una sola prueba, sino en un conjunto de
evidencias complementarias:

- tests unitarios e integración de GW CORE
- tests live de `gdc-sdk-node-ts`
- documentación y `101` actualizados
- OpenAPI regenerado y sincronizado
- runbooks de trust bundle y entorno local Fabric
- publicación de artefactos `.well-known`

Estas evidencias permiten justificar que el sistema no solo ha sido
desarrollado, sino también estructurado para ser integrado y auditado.

## 11. Alcance Pendiente y Límites del Cierre

Persisten líneas de trabajo posteriores. Sin embargo, estas piezas deben considerarse evolución o adaptación de canal,
no una prueba de que el núcleo arquitectónico y funcional del proyecto siga
abierto.

## 12. Conclusión

El proyecto puede darse por cerrado desde una perspectiva de memoria técnica y
funcional porque:

- existe una arquitectura modular coherente
- las funcionalidades principales están cubiertas
- el modelo de seguridad y confianza está explicitado
- la interoperabilidad con FHIR, DID y VC queda soportada
- la adaptación a modos legacy y a envelopes alternativos está contemplada
- los principales lifecycles son ejecutables y documentables
- el sistema puede reproducirse localmente con identidad, GW CORE, ICA y Fabric

En consecuencia, el resultado final es una base de plataforma técnicamente
consistente, comercialmente justificable y preparada para aceptación por parte
de integradores, auditores y clientes.

## 13. Documentación Complementaria Recomendada

Se recomienda como documenatación complementaria:

1. el anexo técnico detallado:
   [05-project-closure-use-cases-and-lifecycles-summary.md](05-project-closure-use-cases-and-lifecycles-summary.md)
2. la tabla funcional BFF `v1.5`
3. los runbooks de trust bundle y local Fabric
4. los scripts y referencias de pruebas live
5. los logs o evidencias de ejecución de los principales casos de uso

## 14. Recomendación de Maquetación en Word

Para adaptación final a Word/PDF se recomienda:

- usar este documento como cuerpo principal de memoria
- añadir portada, identificación del proyecto y alcance contractual
- incorporar tablas y anexos como apéndices
- incluir capturas de ejecución, comandos y artefactos publicados
- cerrar con un bloque de conclusiones y aceptación
