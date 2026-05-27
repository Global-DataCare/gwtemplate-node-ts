# GW deployment profiles

These files document full environment profiles for the GW host deployment.
Each profile represents one real provider combination and should be treated as a complete configuration set.

Current documented profiles:
- `cloud-supabase`: `DB_PROVIDER=postgres` + `STORAGE_PROVIDER=supabase`
- `cloud-firestore`: `DB_PROVIDER=firestore` + `STORAGE_PROVIDER=gcs`

Recommended usage:
1. choose one profile
2. create a private env file from the matching `env.cloud-*.example`
3. render the matching ConfigMap/Secret templates with your real values
4. mount only the variables required by that provider combination

Do not mix provider-specific variables from unrelated profiles in the same deployment unless you have a specific migration reason.
