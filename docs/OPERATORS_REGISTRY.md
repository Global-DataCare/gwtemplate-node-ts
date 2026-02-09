# Operators Registry (JWS)

This registry lists approved operators and is signed with the UNID Foundation FNMT representative certificate.

Files:
- `trust/operators.json`: human-readable registry payload.
- `trust/operators.json.jws`: detached JWS signature over `operators.json`.

## Signing

Prerequisites:
- OpenSSL available on PATH.
- PKCS#12 file with the FNMT certificate + private key.

Run:
```bash
node scripts/sign-operators-registry.mjs \
  --p12 ~/Documents/unid-nuria-fnmt.p12 \
  --input trust/operators.json \
  --output trust/operators.json.jws
```

The script will prompt for the P12 password. You can also provide it via:

```bash
P12_PASS='your-password' node scripts/sign-operators-registry.mjs --p12 ~/Documents/unid-nuria-fnmt.p12
```

## Signature format

- Detached JWS (JSON serialization): the payload is **not** embedded in the signature file.
- Protected header includes: `alg`, `kid`, `x5c`, and `b64=false` + `crit=["b64"]`.
- The payload is the raw bytes of `operators.json` (unencoded).

This layout keeps the registry readable while preserving a standards-based signature.
