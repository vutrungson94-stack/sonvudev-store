# Deployment targets

What the shop can be deployed on, in order of how production-hardened each path is. Node 20+ is required everywhere; the app is a plain Node/Express process with file (or Supabase) persistence and no build step.

| Platform | Path | Status |
|---|---|---|
| Ubuntu VPS (Oracle Always Free works) | `deploy/bootstrap-ubuntu.sh` then `deploy/deploy.sh` + `deploy/Caddyfile` + `deploy/sonvudev-store.service` | ✅ primary target, systemd unit, TLS via Caddy |
| Windows Server | `deploy/deploy.ps1` (artifact → release dir → junction `current` → Windows service via NSSM) | ✅ supported path, PowerShell 5.1+, elevated; see below |
| Docker (any OS incl. Windows/macOS Docker Desktop) | `Dockerfile` | ✅ multi-stage, non-root; set Supabase env or mount a volume at `/app/data` |
| Render free tier | `render.yaml` | ✅ zero-cost host; builds with `npm ci --omit=dev`; set secrets in the dashboard |
| Bare Node (dev / any VM) | `npm start` | ✅ with `data/` writable for the local-file mode |

## Linux / systemd (primary)

```sh
sudo bash deploy/bootstrap-ubuntu.sh   # one-time OS setup: node, caddy, user, /etc/sonvudev-store.env
bash deploy/deploy.sh                  # artifact -> /opt/sonvudev-store/releases/<stamp>, swap `current`, restart, health gate
```

The deploy ships the `publish-output/node` artifact produced by `npm run build`, not the working tree. The script refuses to activate a release whose `/api/health` does not answer 200.

## Windows Server (NSSM service)

One-time setup (elevated PowerShell):

```powershell
# 1. Node 22+ and NSSM installed; then create the service pointing at the shop directory:
nssm install sonvudev-store "C:\Program Files\nodejs\node.exe" "src\server.js"
nssm set sonvudev-store AppDirectory "C:\sonvudev-store\current"
nssm set sonvudev-store AppEnvironmentExtra "NODE_ENV=production" # and your production env vars, or use a file
nssm start sonvudev-store
```

Each release (from the machine with the repo, artifact already built):

```powershell
npm run build
.\deploy\deploy.ps1                      # artifact -> C:\sonvudev-store\releases, junction, restart, health gate
```

NSSM is the service manager; the shop itself is stock Node on Windows. `.gitattributes` pins `*.ps1` to CRLF.

## Docker

```sh
docker build -t sonvudev-store .
docker run -p 3000:3000 -v sonvudev-data:/app/data \
  -e APP_URL=https://example.com -e SUPABASE_URL=... sonvudev-store
```

Without Supabase the app writes `data/*.json` into the container; mount a volume or accept an empty shop on each recreate. The image runs as the unprivileged `app` user with a health check against `/api/health`.

## Render

`render.yaml` declares the service: `npm ci --omit=dev`, start `npm start`, health path `/api/health`. Set `SUPABASE_SERVICE_ROLE_KEY`, `PAYPAL_CLIENT_SECRET`, `RESEND_API_KEY`, `ADMIN_API_TOKEN` and friends in the dashboard — they are deliberately absent from the file. The `checks.yml` workflow audits the live site after a push, but only once `/api/health` reports the commit it is serving (`commit` field); see the workflow for the deploy-gate contract.

## What is deliberately not supported

- Heroku-style read-only filesystems without Supabase configured: the file-backed mode needs a writable `/app/data` (or `DATA_DIR`).
- Serverless (Vercel/Netlify functions): the sweeper and file persistence assume a long-lived process; use Render/VPS/Docker instead.
