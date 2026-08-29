# OpenAPI Profile Matrix

GW CORE mantiene una sola fuente OpenAPI y dos vistas derivadas. Ninguna de
ellas representa plugins ni extensiones de producto.

| Artefacto | Alcance | Fuente |
| --- | --- | --- |
| `swagger-spec.json` | API completa implementada por el runtime GW CORE | JSDoc y configuración Swagger |
| `openapi-core.json` | Recorrido canónico reducido de onboarding, identidad, consentimiento, comunicación, composición e investigación | `CORE_FLOW_PATHS` |
| `openapi-compat.json` | API completa de CORE, marcando los alias heredados como `compat` | `classifyPath` |

La lista ejecutable y autoritativa de las 33 rutas del recorrido canónico está
en `scripts/generate-openapi-profiles.mjs#CORE_FLOW_PATHS`. Duplicarla aquí
haría posible que la documentación divergiera de la generación real.

## Clasificación de operaciones

- `core`: ruta implementada por GW CORE que no es un alias de compatibilidad.
- `compat`: alias de identidad bajo `/identity/openid/*`, `/auth/token` y las
  rutas directas heredadas de resumen de sujeto/paciente.

Las rutas `Observation/_batch` y `Subject/_batch` son capacidades del runtime
completo de CORE; no son extensiones. Que una ruta no pertenezca al recorrido
canónico reducido no la convierte en un plugin.

## Frontera de soluciones derivadas

Las capacidades adicionales de una solución se implementan, prueban y publican
desde su repositorio derivado. GW CORE no genera `openapi-extension.json` ni
anuncia un perfil `EXTENSIONS` en Swagger UI.

## Regeneración verificable

```bash
npm run build:swagger
git diff --exit-code -- swagger-spec.json swagger-spec.reference.json \
  docs/openapi-profiles docs/openapi-examples
```

El segundo comando demuestra que los JSON versionados coinciden con el JSDoc y
el generador del checkout actual.
