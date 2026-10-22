# Evidencia local de preparación para producción

Imagen: `gw-core:1.25.24-e7fdd71`

## Comprobaciones verificadas

- 00-environment: PASS
- 10-dataspace-ca-tests: PASS
- 11-dataspace-ca-publication: PASS
- 20-dataspace-ica-host-activation: PASS
- 21-dataspace-ica-postgres-ipfs-migration: PASS
- 30-fabric-governance-contract: PASS
- 31-fabric-multi-host-topology: PASS
- 35-human-channel-taxonomy: PASS
- 36-employee-onboarding-contract: PASS
- 40-gw-postgres-ipfs-fabric-runtime: PASS
- 45-helm-kubernetes-runtime: PASS

## Separación entre hosts y tenants

`Host1MSP` y `Host2MSP` son miembros de Fabric. Las organizaciones tenant identificadas por VAT son datos de aplicación alojados por un GW y no son MSP de Fabric. Los dos peers locales participan en `identity-local` y `health-care-local`; `onehealth-research` es un sector del GW, no un canal. En el perfil europeo, organizaciones y empleados usan `identity-eu`, mientras que las personas usan `identity-global`.

## Prueba de acceso de un empleado

El contrato de alta crea un secretario médico limitado a su organización. La prueba real con PostgreSQL, IPFS y Fabric crea datos de una persona, concede un consentimiento IPS explícito al secretario, acredita la lectura autorizada mediante SMART y deniega a otro secretario sin consentimiento. El perfil mantiene separadas las vinculaciones de identidad de organización y de persona.

## Migración de la ICA

El gate `21-dataspace-ica-postgres-ipfs-migration` ejecuta con datos sintéticos el migrador open source de las cuatro colecciones de Firestore a PostgreSQL y de los contratos de auditoría GCS a Kubo/IPFS privado y cifrado. Relee PostgreSQL y cada CID, exige cero referencias GCS pendientes y compara los digests de origen transformado y destino. Los datos y PDF reales no forman parte de la evidencia pública.

## Prueba Kubernetes mediante Helm

El gate `45-helm-kubernetes-runtime` instala un nuevo peer de `Host2MSP`, CouchDB, GW, PostgreSQL, IPFS y diez runtimes CCAAS en un clúster kind mediante el chart público. Los certificados del peer y de la identidad cliente del GW conservan el SHA-256 del identificador de la misma Host VC usada para la admisión. El peer se une a `identity-local` y `health-care-local`, instala y aprueba los diez paquetes CCAAS, y el GW firma como `Host2MSP` contra ese peer para repetir Consent y SMART. Después reinicia GW, peer y CCAAS y demuestra persistencia y nueva capacidad de endoso; el peer Docker queda limitado a gossip/bootstrap.

## Admisión dinámica demostrada

La puerta Fabric arranca los canales únicamente con `Host1MSP`. Una Host VC-JWT desechable se verifica criptográficamente, el grant Fabric queda limitado a dos usos y el certificado resultante se vincula al SHA-256 de su identificador. El reconciliador con driver Fabric vivo calcula y firma la entrada de `Host2MSP`, aplica la mutación, arranca el segundo peer y lo une. La evidencia comprueba después pertenencia, lifecycle y tráfico GW desde el peer Kubernetes del MSP recién admitido.
