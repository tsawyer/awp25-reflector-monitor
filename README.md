# AWP25 Reflector Monitor

Public, read-only P25 reflector activity and health dashboard for Debian 12. The server reads the current `P25Reflector*.log` file, keeps IP addresses private, and exposes a small sanitized status endpoint to the browser.

## Local development

Requires Node.js 22+ and pnpm.

```bash
corepack enable
pnpm install
pnpm dev
```

Development automatically uses representative demo telemetry when no reflector log is available. Copy `.env.example` to `.env.local` to override the reflector name, talkgroup, NAC, or log directory.

## Debian 12 deployment

1. Install Node.js 22, enable Corepack, and install nginx.
2. Copy the project to `/opt/awp25-monitor`, then run `pnpm install --frozen-lockfile` and `pnpm build`.
3. Create the locked-down service account: `sudo useradd --system --home /opt/awp25-monitor --shell /usr/sbin/nologin awp25-monitor`.
4. Copy `.env.example` to `/etc/awp25-monitor.env` and set the production paths.
5. Grant the service account read-only access to the reflector logs, normally by adding it to the reflector log group. Make `/opt/awp25-monitor/.next/cache` writable by the service account.
6. Install `deploy/awp25-monitor.service` in `/etc/systemd/system/`, then enable and start it.
7. Adapt `deploy/nginx.conf` with the public hostname and install it in `/etc/nginx/sites-enabled/`.

The application listens only on `127.0.0.1:3000`; nginx is the public edge. Add TLS with the site's normal certificate workflow before exposing it publicly.

## Data inputs

- `P25_LOG_DIR`: directory containing rotating `P25Reflector*.log` files.
- `P25_STATUS_FILE`: optional JSON snapshot path. When set, this takes precedence over logs and is useful if an existing collector already produces clean telemetry.
- `P25_DEMO_MODE=1`: explicitly enables representative demo telemetry in production. Leave unset on the live server.

The parser recognizes common P25Reflector connection, disconnection, transmission-start, and transmission-end log lines. A JSON fixture and parser tests document the normalized public response shape.
