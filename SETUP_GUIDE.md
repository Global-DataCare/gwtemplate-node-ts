# Setup and Configuration Guide

This guide provides detailed instructions for setting up the necessary environment variables to run the service. A proper configuration is essential for the `host` entity to bootstrap itself correctly on startup.

## Host Configuration (`.env` file)

Create a `.env` file in the root of the project. The following variables are required to configure the "Tenant Zero" or `host` organization.

| Variable                      | Description                                                                                              | Example Value                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `PORT`                        | The network port on which the server will listen.                                                        | `3000`                                 |
| `API_HOSTNAME`                | The public-facing hostname of the server. Used to construct DIDs.                                        | `localhost`                            |
| `NODE_ENV`                    | The operating environment. Use `production` for live deployments, otherwise `development` or `demo`.       | `demo`                                 |
| `SECTORS_ALLOWED`             | A comma-separated list of sectors the host is allowed to register tenants for.                           | `health-care,emergency`                |
| `KEK_SECRET`                  | **CRITICAL:** A Base64-encoded, 32-byte secret used to derive the master Key Encryption Key (KEK).         | `your-super-secret-base64-key`         |
|                               |                                                                                                          |                                        |
| `ORG_HOST_LEGAL_NAME`         | The official legal name of the host organization.                                                        | `Gateway Host Services Inc.`           |
| `ORG_HOST_JURISDICTION`       | The two-letter country code where the host organization is legally registered (e.g., ISO 3166-1 alpha-2). | `ES`                                   |
| `ORG_HOST_ID_TYPE`            | The type of official identifier for the organization (e.g., 'TAX', 'DUNS').                                | `TAX`                                  |
| `ORG_HOST_ID_VALUE`           | The value of the official identifier.                                                                    | `A12345678`                            |
| `ORG_HOST_ADMIN_EMAIL`        | The email address of the designated administrative contact for the host.                                 | `admin@host.example.com`               |
| `ORG_HOST_ADMIN_UID`          | A stable, unique identifier (UUID) for the host's primary administrator.                                   | `a1b2c3d4-e5f6-7890-1234-567890abcdef` |

---
## Example `.env` file

```env
# Server Configuration
PORT=3000
API_HOSTNAME=localhost
NODE_ENV=demo
SECTORS_ALLOWED=health-care,emergency,health-insurance

# Security (use a secure, randomly generated key)
KEK_SECRET=your-super-secret-base64-key

# Host Organization Identity
ORG_HOST_LEGAL_NAME="Gateway Host Services Inc."
ORG_HOST_JURISDICTION=ES
ORG_HOST_ID_TYPE=TAX
ORG_HOST_ID_VALUE=A12345678
ORG_HOST_ADMIN_EMAIL=admin@host.example.com
ORG_HOST_ADMIN_UID=a1b2c3d4-e5f6-7890-1234-567890abcdef
```
