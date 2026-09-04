# Migración o promoción de la ICA del espacio de datos

Esta guía es para una operación real. No forma parte de la evidencia local del
entregable, aunque utiliza el mismo migrador público ya probado.

## 1. Decisión que debe quedar escrita

Antes de ejecutar nada, el responsable del entorno de la ICA deja por escrito
una sola opción:

- **Traslado del mismo entorno:** se conserva el DID emisor, se migran los
  registros autorizados y se transfiere el material de firma por custodia
  cifrada separada.
- **Promoción de staging a producción:** se crea el perfil productivo y solo se
  migran los registros expresamente aprobados. No se copian automáticamente
  credenciales, claves ni autorizaciones de staging.

Sin esa decisión no se cambia DNS ni se ejecuta la migración real.

## 2. Datos que entrega cada responsable

| Responsable | Debe entregar antes de continuar |
| --- | --- |
| Autoridad de la ICA | opción anterior, DID emisor, dominios, sectores, jurisdicciones y política de hosts permitidos |
| Custodio del origen | export Firestore y directorio `ica-audit/`, ambos cifrados y con hashes |
| Operador Kubernetes | namespace, StorageClass, IngressClass, DNS/TLS, registro OCI y política de backup |
| Operador de datos | URL PostgreSQL, API privada de Kubo/IPFS y directorio privado de evidencias |
| Custodio criptográfico | mecanismo de inyección de la clave de firma; nunca correo, Git o ZIP |

## 3. Verificar primero el migrador público

```bash
git clone https://github.com/Global-DataCare/dataspace-ica-ts.git
cd dataspace-ica-ts
npm ci
npm run evidence:migration:postgres-ipfs
```

Referencia pública:
[migración PostgreSQL/IPFS](https://github.com/Global-DataCare/dataspace-ica-ts/blob/main/docs/06-architecture-and-reference/02-postgres-ipfs-gap.md).

No continúe si el resultado no contiene `Migration PASS`.

## 4. Ensayo privado con una copia

Un export administrado de Firestore no es SQL ni JSON. Impórtelo primero en
una base Firestore temporal privada o use el origen vivo en modo de solo
lectura. Descargue `ica-audit/` conservando sus rutas relativas.

```bash
export FIRESTORE_PROJECT_ID='<proyecto-firestore-temporal-o-origen>'
export ICA_MIGRATION_CONFIRM_SOURCE_PROJECT="${FIRESTORE_PROJECT_ID}"
export ICA_MIGRATION_SOURCE_COLLECTIONS_PREFIX='<prefijo-origen>'
export ICA_MIGRATION_TARGET_COLLECTIONS_PREFIX='<prefijo-destino>'
export ICA_MIGRATION_AUDIT_SOURCE_DIR='/secure/migration/gcs'
export ICA_MIGRATION_OUTPUT_DIR='/secure/migration/evidence/ensayo-001'
export POSTGRES_URL='<url-postgresql-privada>'
export IPFS_API_URL='<api-kubo-privada>'
export ICA_MIGRATION_IPFS_CUSTODY='private-encrypted'
export ICA_MIGRATION_DATA_PROTECTION_CONFIRMED='true'

node src/api/scripts/migrate-firestore-gcs-to-postgres-ipfs.ts --apply
```

La salida obligatoria es:

- `Migration PASS`;
- cero referencias GCS sin resolver;
- digest de origen transformado igual al de PostgreSQL;
- cada CID recuperable y con el SHA-256 esperado.

## 5. Desplegar la nueva ICA sin cambiar DNS

La imagen OCI verificada de la ICA del espacio de datos está publicada en:

- [paquete `dataspace-ica`](https://github.com/orgs/Global-DataCare/packages/container/package/dataspace-ica);
- `ghcr.io/global-datacare/dataspace-ica@sha256:2e0faee426f7e1c438409a99ae2ab61f4aa21fc1ef615de3928ee1c020092053`.

El operador Kubernetes comprueba y utiliza ese digest inmutable:

```bash
export ICA_IMAGE='ghcr.io/global-datacare/dataspace-ica@sha256:2e0faee426f7e1c438409a99ae2ab61f4aa21fc1ef615de3928ee1c020092053'
docker pull "${ICA_IMAGE}"
docker buildx imagetools inspect "${ICA_IMAGE}"
```

Las plantillas Kubernetes públicas de la ICA están en
[`deploy/k8s`](https://github.com/Global-DataCare/dataspace-ica-ts/tree/main/deploy/k8s).
El operador Kubernetes materializa en su inventario privado:

```dotenv
DB_PROVIDER=postgres
POSTGRES_URL=<secreto>
STORAGE_PROVIDER=ipfs
IPFS_API_URL=<secreto-o-url-interna>
ICA_COLLECTIONS_REQUIRED=true
ICA_AUDIT_STORAGE_REQUIRED=true
```

Además configura el DID, cadena pública y clave de firma mediante su gestor de
secretos. Arranca la ICA con un nombre temporal o prueba la IP nueva sin
cambiar DNS.

## 6. Aceptación y corte

```bash
curl --fail --show-error https://<dominio-temporal-o-resuelto>/
curl --fail --show-error https://<dominio-temporal-o-resuelto>/.well-known/did.json
curl --fail --show-error https://<dominio-temporal-o-resuelto>/openapi.json >/tmp/ica-openapi.json
```

Después se prueba emisión, consulta, revocación, recuperación de un objeto por
CID, backup y restauración. Solo con todas las pruebas aprobadas:

1. congelar escrituras en el origen;
2. repetir exportación y migración final;
3. comprobar hashes y recuentos;
4. cambiar DNS;
5. conservar el origen durante la ventana de rollback;
6. registrar commit, digest de imagen, informe y hora del corte.

La siguiente fase es
[`PUESTA_EN_MARCHA_HOST_ES.md`](./PUESTA_EN_MARCHA_HOST_ES.md).
