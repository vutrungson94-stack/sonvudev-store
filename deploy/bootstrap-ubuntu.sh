#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
# caddy is not optional any more: deploy.sh copies deploy/Caddyfile to
# /etc/caddy/Caddyfile and reloads the service, so a host without caddy would fail
# its next deploy rather than serve.
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw rsync
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
# Node 22, because it is what .github/workflows/checks.yml exercises alongside 20 and
# 24 and what package.json's `node >=20` floor allows. The pin lives here and nowhere
# else, so a mismatch with the tested versions would have to be introduced on purpose.
echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y nodejs

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /tmp/caddy.list
mkdir -p /etc/apt/keyrings
cp /tmp/caddy.list /etc/apt/keyrings/caddy-stable.list
sed -i 's|^deb |deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] |' /etc/apt/keyrings/caddy-stable.list
apt-get update
apt-get install -y caddy

ufw allow OpenSSH
ufw allow 'HTTP/HTTPS'
ufw --force enable

node --version
npm --version
caddy version
systemctl --version | head -n 1

# Everything deploy.sh needs, checked here where a fix is one re-run away. A deploy
# that fails on line 63 of a release script is far more expensive to diagnose than a
# bootstrap that refuses to finish.
for required in node npm caddy rsync curl; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "ERROR: $required is missing after bootstrap." >&2
    exit 1
  fi
done
# deploy.sh runs as root and drops to the shop user with `su`, so this must exist and
# must accept a login shell — nologin would make `su -s /bin/bash sonvudev -c` fail
# with "invalid shell" at the moment of a deploy.
if ! id sonvudev >/dev/null 2>&1; then
  useradd --system --home /opt/sonvudev-store --shell /bin/bash sonvudev
  echo "Created the sonvudev service user (deploy.sh needs it to exist)."
fi
echo "Bootstrap complete."
