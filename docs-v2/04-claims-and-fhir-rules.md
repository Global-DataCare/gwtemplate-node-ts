# 04 Claims and FHIR Rules

- Claims map to interoperable IDs (`Resource.param-name`).
- Keep aliases only as temporary compatibility and mark them TODO.
- For medication capture:
  - human capture text in `MedicationStatement.note`
  - medication artifact text in `MedicationStatement.medication-text`
