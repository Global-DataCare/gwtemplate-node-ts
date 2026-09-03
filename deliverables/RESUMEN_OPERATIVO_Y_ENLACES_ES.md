# Resumen operativo y referencias públicas

Texto de transferencia para el equipo responsable:

> El proceso está separado en tres recorridos públicos. Primero puede
> reproducirse el entregable local sin datos reales. Después se migra o
> promociona la ICA del espacio de datos. Cuando la ICA esté validada, se da de
> alta el host primero en test-network y se repite con identidades nuevas en
> producción. Cada guía indica quién ejecuta cada paso, qué fichero recibe el
> siguiente responsable y dónde detenerse.
>
> 1. Entregable local reproducible:
> https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/deliverables/ENTREGABLE_LOCAL_REPRODUCIBLE_ES.md
>
> 2. Migración o promoción de la ICA:
> https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/deliverables/MIGRACION_Y_DESPLIEGUE_ICA_ES.md
>
> 3. Puesta en marcha del host en test-network y producción:
> https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/deliverables/PUESTA_EN_MARCHA_HOST_ES.md
>
> Herramienta de bootstrap y solicitud de Host VC:
> https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/scripts/onboarding/request-host-credential.mjs
>
> La ICA genera desde su pod una activación de un solo uso ligada al dominio,
> red, identidad legal, controller, jurisdicción y contexto aprobados. La
> entrada se lee del ordenador mediante `kubectl exec -i`; la salida se captura
> en ese mismo ordenador, se entrega cifrada al DevOps del host y sustituye
> cualquier intercambio de un `did.json` provisional.
>
> Chart Helm público:
> https://github.com/orgs/Global-DataCare/packages/container/package/gdc-host
>
> El responsable del host recibe por canal seguro un paquete privado cifrado
> formado por `peer-enrollment-grant.json`,
> `gw-client-enrollment-grant.json`, `fabric-ica-ca-chain.pem`,
> `fabric-endpoints.json`, `authorization.json`,
> `host-apply-confirmation.json`, `onboarding.host.json` y
> `manifest.sha256`. Verifica los hashes antes de ejecutar el rol `host`. La
> Host VC-JWT, el PDF, el administrador del MSP, el registrador de Fabric CA y
> el inventario completo no forman parte de esa entrega.

Los dominios, IP, correos, datos, `values`, VC, grants, MSP/TLS, claves y
Secrets reales se intercambian aparte mediante un canal privado.
