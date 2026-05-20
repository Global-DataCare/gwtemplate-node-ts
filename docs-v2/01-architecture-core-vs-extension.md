# 01 Architecture: Core vs Extension

- Core scope: canonical contracts (`Communication`, `Composition`, `DocumentReference`, validation baseline).
- Extension scope: operational domain logic (`Task`/`Appointment` reminders, channel-specific orchestration).
- Rule: extension must not break core contracts.
