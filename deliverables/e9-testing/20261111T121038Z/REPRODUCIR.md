# Repetir y revisar E9

## Verificar la copia publicada

Desde GW Core, con Node 26.13.0:

```bash
npm ci
npm run test:e9-evidence
npm run verify:e9 -- deliverables/e9-testing/20261111T121038Z/manifest.json
cd deliverables/e9-testing/20261111T121038Z
shasum -a 256 -c SHA256SUMS.txt
```

## Repetir las pruebas

`source-checkouts.json` contiene los siete commits exactos. Prepare checkouts independientes llamados `e9-repair-<repositorio>`, instale cada lockfile con `npm ci` y conserve las salidas. Guarde los resultados de cada ejecución en un directorio nuevo.

Defina `E9_WORKSPACE_ROOT`, `E9_WORKTREES_ROOT` y `E9_OUTPUT_ROOT` para los scripts de `reproduce/`. `E9_WORKSPACE_ROOT` identifica el workspace con los PDF privados autorizados; `E9_WORKTREES_ROOT` contiene los siete checkouts; `E9_OUTPUT_ROOT` recibe los resultados nuevos. Los scripts usan el ejecutable Node activo y rechazan una versión distinta de 26.13.0.

Ejecute secuencialmente:

- Utilidades: `npm run typecheck` y `npm run test:coverage -- --runInBand --watchman=false --detectOpenHandles`.
- Core: `npm run type-check` y `npm test`.
- Front: `npm run type-check`, `npm test` y `npm run verify:package-chain`.
- Cliente ICA: `npm test -- --runInBand`, `npm run test:pack:esm` y `npm run lint`.
- ICA: `npm run check` y `node --test --test-concurrency=1 ./test/api*.test.ts`, con `ICA_REAL_TERMS_PDF_FIXTURE` apuntando al anexo privado cuyo hash figura en el manifiesto. Los demás PDF reales se resuelven en la ruta canónica del repositorio: `$HOME/GITS/gdc-workspace/examples`.
- SDK Node: `npm run type-check`; para la parte unitaria use los argumentos completos de `sdk-node-unit` en el manifiesto. `node-file-inventory.json` distingue los 66 ficheros unitarios de los 6 E2E que también deben ejecutarse.

`run_gate.py <repositorio> <etiqueta> <comando...>` guarda comando, runtime, commits, estado de los checkouts, hashes de manifests, salida íntegra y código de salida. `run_ica_live.py <etiqueta>` arranca una ICA local con su clave pública de fixture y ejecuta la integración HTTP existente. Permite fijar `E9_FNMT_PDF` para el PDF requerido.

`run_profiles.py <etiqueta>` arranca los servicios locales en 33300/33310, crea el tenant y su consentimiento por el SDK, y ejecuta los dos perfiles independientes. Rechaza puertos ocupados y detiene únicamente sus procesos.

Para los otros recorridos use los lanzadores versionados: `scripts/run-secure-e2e-google-user.sh` de GW, `scripts/run-live-101-full-cycle-clean.sh` y `scripts/run-live-controller-lifecycle.sh` de SDK Node. El manifiesto conserva todos sus parámetros. Fije explícitamente ambos checkouts GW/ICA y el workspace; en el ciclo BFF humano use `SECTOR=health-care` y el rol canónico `ISCO-08|2211`. Copie `env.local-demo.example` a `.env.local-demo` en el checkout desechable de GW; mantenga `KMS_PROVIDER=memory` para este perfil local. Compruebe que 3000 y 3310 están libres antes de utilizar los lanzadores que limpian sus puertos.

Para repetir las pruebas de documentos, utilice los PDF firmados identificados por las huellas del manifiesto. El acceso a estas entradas forma parte de la preparación del entorno.

Registre cada ejecución con sus commits, fechas, comandos, archivos de entrada y huellas.

Las huellas `log.sha256` verifican los archivos publicados ya saneados. `originalSha256` y `log_sha256` de los registros de procedencia identifican el original privado anterior al saneamiento.
