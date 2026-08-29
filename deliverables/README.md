# Entregables en español

Esta carpeta contiene los documentos públicos y reutilizables para justificar
y transferir el despliegue de un host. No contiene nombres de participantes,
dominios, direcciones, credenciales ni inventarios de un proveedor concreto.

- `GUIA_HOST_REPRODUCIBLE_ES.docx`: Word público para memoria y consultoría.
- `GUIA_HOST_REPRODUCIBLE_ES.html`: fuente editable del Word.
- `GUIA_OPERATIVA_HOST_ES.md`: procedimiento copiable por rol para
  `local-network`, `test-network` y producción.
- `ENTREGABLE_HOST_REPRODUCIBLE_ES.md`: alcance, ejecución y límites
  verificables del entregable de software.

Los anexos específicos de un proveedor se mantienen fuera del repositorio
público y deben fijar el commit y los checksums de esta entrega.

## Imágenes OCI públicas verificadas

- [GW CORE](https://github.com/orgs/Global-DataCare/packages/container/package/gw-core):
  `ghcr.io/global-datacare/gw-core@sha256:6b37c7dfea17dc2ee42628c5467fb5b44fe7f669536e695bd4f2932714485e5f`
- [Runtime CCAAS](https://github.com/orgs/Global-DataCare/packages/container/package/host-runtime):
  `ghcr.io/global-datacare/host-runtime@sha256:67e5c0fb93efbdc79812a3579ea0b9b0d8e230fca8d430c72e81666a7389f7ac`

GW CORE y CCAAS son artefactos independientes. El segundo contiene los nueve
servidores de chaincode, pero sus package IDs se generan para el nombre,
namespace y Services exactos de cada release Helm.
