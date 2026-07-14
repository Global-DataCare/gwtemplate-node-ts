# 03 Run E2E

This file follows the shared narrative contract in
[01-narrative-contract.md](./01-narrative-contract.md).

Use a fixed sequence:
1. Start backend API.
2. Bootstrap tenant/context.
3. Run channel/service E2E script.

Capture:
- submit status
- poll status
- failing endpoint + payload shape + claim keys
