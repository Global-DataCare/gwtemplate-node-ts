# Entregables en español

Esta carpeta contiene los documentos públicos y reutilizables para justificar
y transferir el despliegue de un host. No contiene nombres de participantes,
dominios, direcciones, credenciales ni inventarios de un proveedor concreto.

- `ENTREGABLE_LOCAL_REPRODUCIBLE_ES.md`: prueba local para auditoría; no es una
  migración ni un despliegue externo.
- `MIGRACION_Y_DESPLIEGUE_ICA_ES.md`: operación real para trasladar o promover
  la ICA del espacio de datos a PostgreSQL/IPFS.
- `PUESTA_EN_MARCHA_HOST_ES.md`: recorrido corto y secuencial para dar de alta
  un host primero en `test-network` y después en producción.
- `MENSAJE_CORTO_ENLACES_ES.md`: texto reenviable por email o WhatsApp con los
  enlaces públicos anteriores.
- `GUIA_HOST_REPRODUCIBLE_ES.docx`: Word público para memoria y consultoría.
- `GUIA_HOST_REPRODUCIBLE_ES.html`: fuente editable del Word.
- `GUIA_OPERATIVA_HOST_ES.md`: procedimiento copiable por rol para
  `local-network`, `test-network` y producción.
- `ENTREGABLE_HOST_REPRODUCIBLE_ES.md`: alcance, ejecución y límites
  verificables del entregable de software.

Los anexos específicos de un proveedor se mantienen fuera del repositorio
público y deben fijar el commit y los checksums de esta entrega.

Orden para una operación real:

```text
MIGRACION_Y_DESPLIEGUE_ICA_ES.md
                  ↓
PUESTA_EN_MARCHA_HOST_ES.md (test-network)
                  ↓
PUESTA_EN_MARCHA_HOST_ES.md (network, con identidades nuevas)
```

El entregable local se ejecuta aparte para demostrar la reproducibilidad de
las mismas herramientas, sin afirmar que una infraestructura externa ya esté
migrada o desplegada.

## Chart Helm público

El mismo chart validado en `local-network` se distribuye como OCI:

```bash
helm pull oci://ghcr.io/global-datacare/gdc-host --version 0.3.0
helm show chart oci://ghcr.io/global-datacare/gdc-host --version 0.3.0
```

Paquete: [gdc-host en GHCR](https://github.com/orgs/Global-DataCare/packages/container/package/gdc-host).
Digest del manifiesto OCI publicado:
`sha256:1382c6d302dea258ee1c625e300e60c6a0b63959b3adef72da7d92a46e397784`.

El proveedor puede usar el artefacto OCI o el directorio `charts/gdc-host` del
commit entregado. Los `values`, Secrets, VC, grants, MSP/TLS, endpoints y
package IDs son siempre propios del entorno y quedan fuera del repositorio.

## Imágenes OCI públicas verificadas

- [GW CORE](https://github.com/orgs/Global-DataCare/packages/container/package/gw-core):
  `ghcr.io/global-datacare/gw-core@sha256:6b37c7dfea17dc2ee42628c5467fb5b44fe7f669536e695bd4f2932714485e5f`
- [Runtime CCAAS](https://github.com/orgs/Global-DataCare/packages/container/package/host-runtime):
  `ghcr.io/global-datacare/host-runtime@sha256:67e5c0fb93efbdc79812a3579ea0b9b0d8e230fca8d430c72e81666a7389f7ac`

GW CORE y CCAAS son artefactos independientes. El segundo contiene los nueve
servidores de chaincode, pero sus package IDs se generan para el nombre,
namespace y Services exactos de cada release Helm.
