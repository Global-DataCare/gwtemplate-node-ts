# Entregable E9 — pruebas unitarias e integración

Ejecución del 11 de noviembre de 2026 en macOS, con Node.js `v26.13.0`, npm `11.20.0` y perfiles locales test/demo.

| Batería | Superados / total | Fallidos | Omitidos | Pendientes |
|---|---:|---:|---:|---:|
| common-coverage | 935/935 | 0 | 0 | 0 |
| sdk-core | 134/134 | 0 | 0 | 0 |
| sdk-front | 69/69 | 0 | 0 | 0 |
| sdk-node-unit | 345/345 | 0 | 0 | 0 |
| sdk-node-gw-and-consent | 6/6 | 0 | 0 | 0 |
| sdk-node-full-cycle | 1/1 | 0 | 0 | 0 |
| sdk-node-controller | 1/1 | 0 | 0 | 0 |
| sdk-node-profile-individual | 1/1 | 0 | 0 | 0 |
| sdk-node-profile-professional | 1/1 | 0 | 0 | 0 |
| ica-api | 309/309 | 0 | 0 | 0 |
| ica-client-isolated | 52/52 | 0 | 0 | 0 |
| ica-client-live | 2/2 | 0 | 0 | 0 |
| gw-runtime | 13/13 | 0 | 0 | 0 |

`manifest.json` identifica versiones, commits, comandos, fechas y resultados. `logs/` recoge las salidas de las baterías; `provenance/` sus registros de ejecución; y `checks/` las instalaciones, dependencias y comprobaciones complementarias.

`SHA256SUMS.txt` contiene las huellas de los archivos publicados. Las huellas `log.sha256` corresponden a los logs publicados; `originalSha256` y los registros de procedencia identifican los archivos de ejecución originales. Los finales de línea se normalizan a LF.

[Entregable E9: pruebas unitarias y testeo](../../E9_PRUEBAS_UNITARIAS_Y_TESTEO_SEDIA_ES.md).

Comprobación del expediente desde GW Core:

```bash
npm run verify:e9 -- deliverables/e9-testing/20261111T121038Z/manifest.json
```
