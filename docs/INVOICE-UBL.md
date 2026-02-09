# UBL / EN 16931 Validation (Test-Only)

This project includes a unit test that validates a minimal UBL invoice against an EN 16931 XSD, and computes a SHA-256 hash for anchoring.

## Test

Set the schema path and run unit tests:

```bash
PEPPOL_INVOICE_XSD=/path/to/EN16931-UBL-Invoice.xsd npm run test:unit
```

Notes:
- The test uses `xmllint` for XSD validation. Install `libxml2` if missing.
- Schematron validation is **TODO**; EN 16931 business rules require Schematron in addition to XSD.
- The hash is computed on raw XML; canonicalization (C14N) is **TODO** before signing/anchoring.
