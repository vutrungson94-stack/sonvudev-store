#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT=/opt/sonvudev-store
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="$APP_ROOT/releases/$RELEASE_ID"
CURRENT_LINK="$APP_ROOT/current"

# Deploys the build's artifact, not the working tree.
#
# It used to copy whatever directory it was pointed at, which meant the thing
# that reached production was never the thing the build checked: the artifact in
# publish-output/node had passed the 45-file existence gate, the audit and the
# metrics gate, and then was not deployed. Meanwhile the working tree carried
# .env.backup-*, an external build tool's plaintext cache of every production
# secret, and the entire .git history — all of it copied into a release directory
# that a running process holds open.
#
# So the artifact is the input, and the working tree is refused. Someone who
# genuinely needs to ship uncommitted changes runs `npm run build` first, which
# is the right answer anyway: the gate is fast and the artifact is the only thing
# that has been through it.
SOURCE_DIR="${1:-}"

if [[ -z "$SOURCE_DIR" ]]; then
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  SOURCE_DIR="$REPO_ROOT/publish-output/node"
fi

if [[ ! -f "$SOURCE_DIR/package.json" ]]; then
  echo "ERROR: $SOURCE_DIR is not a deployable artifact (no package.json)." >&2
  echo "       Run 'npm run build' first, then re-run this script." >&2
  exit 1
fi

# A release must not contain the developer's machine. The artifact cannot carry
# these today because the build only copies the six source directories and four
# named files, but the check is kept because the cost of it being wrong is every
# production secret in a directory served by a live process, and the cost of the
# check is one line.
for forbidden in .env .git data logs publish-output .wrangler .gbuildcache; do
  if [[ -e "$SOURCE_DIR/$forbidden" ]]; then
    echo "ERROR: artifact contains $forbidden — refusing to deploy." >&2
    exit 1
  fi
done
if find "$SOURCE_DIR" -type d \( -name .wrangler -o -name .gbuildcache \) -print -quit | grep -q .; then
  echo "ERROR: artifact contains tool scratch (.wrangler/.gbuildcache) — refusing to deploy." >&2
  exit 1
fi
if compgen -G "$SOURCE_DIR/.env.*" >/dev/null; then
  echo "ERROR: artifact contains a .env.* backup — refusing to deploy." >&2
  exit 1
fi

if [[ ! -f /etc/sonvudev-store.env ]]; then
  echo "ERROR: /etc/sonvudev-store.env is missing. Configure production secrets first." >&2
  exit 1
fi

id sonvudev >/dev/null 2>&1 || useradd --system --home "$APP_ROOT" --shell /usr/sbin/nologin sonvudev
install -d -o sonvudev -g sonvudev -m 0755 "$APP_ROOT" "$APP_ROOT/releases" "$APP_ROOT/shared"
install -d -o sonvudev -g sonvudev -m 0755 "$RELEASE_DIR"
cp -a "$SOURCE_DIR"/. "$RELEASE_DIR"/

cd "$RELEASE_DIR"
# No sudo. This script installs into /opt and /etc/systemd/system, so it must run as
# root already — deploy/bootstrap-ubuntu.sh refuses to start unless EUID is 0 — and
# it uses plain `install` and `su` throughout for exactly that reason. The sudo calls
# here were not merely redundant: on a minimal Ubuntu image sudo is not installed
# unless someone installed it, and bootstrap-ubuntu.sh does not install it, so
# `npm ci` died on line 63 of an otherwise successful deploy.
run_as_shop() { su -s /bin/bash sonvudev -c "$1"; }
run_as_shop "cd '$RELEASE_DIR' && npm ci --omit=dev --ignore-scripts"

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
chown -h sonvudev:sonvudev "$CURRENT_LINK"
chown -R sonvudev:sonvudev "$RELEASE_DIR" "$APP_ROOT/shared"

# Caddy is installed because the artifact ships deploy/Caddyfile and nothing has
# used it. The file was in every artifact and in no release: this copied the unit
# file only, so the reverse proxy kept serving whatever configuration it had on the
# day it was set up, and a change to Caddyfile could never reach the host.
# TLS renewal is refused until the file is in place — a missing site block means no
# certificate for the domain, which is worse than a failed deploy.
install -m 0644 "$SOURCE_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
if ! command -v caddy >/dev/null 2>&1; then
  echo "ERROR: caddy is not installed but deploy/Caddyfile was copied." >&2
  echo "       Install caddy, or remove deploy/Caddyfile from scripts/lib/artifact.mjs." >&2
  exit 1
fi
# The unit is installed from the artifact on every deploy, for the same reason the
# Caddyfile is: the change to a unit file has to be able to reach the host.
#
# It used to be copied only by bootstrap, so a host set up before that edit had no
# unit at all, and this script then ran `systemctl enable --now sonvudev-store`
# against a unit the system had never heard of. Under `set -e` that aborts the
# deploy after the release symlink has already been swapped — the new code is
# live, the service that is supposed to run it is not, and the rollback below is
# the thing that gets reached for.
install -m 0644 "$SOURCE_DIR/deploy/sonvudev-store.service" /etc/systemd/system/sonvudev-store.service
systemctl daemon-reload
systemctl enable --now sonvudev-store
systemctl restart sonvudev-store
# Reload rather than restart: a restart drops every in-flight request, a reload
# leaves the proxy up while it re-reads the file. Validate first — caddy refuses to
# start on a bad config, and taking the proxy down to find that out is the failure
# this avoids.
if ! caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
  echo "ERROR: /etc/caddy/Caddyfile is not valid — Caddyfile left in place, proxy not reloaded." >&2
  echo "       Fix the file or run: caddy fmt /etc/caddy/Caddyfile" >&2
  exit 1
fi
systemctl reload caddy

# Fail the deploy here rather than in the uptime monitor ten minutes later. The
# health endpoint answers 503 whenever a probe fails, and one of its probes is
# the data directory being writable — which is exactly what a wrong DATA_DIR
# looks like. Waiting for the monitor to notice means every release between this
# one and the fix is quietly refusing orders.
echo -n "Health: "
if health_code=$(curl -fsS -o /dev/null -w '%{http_code}' --retry 10 --retry-delay 3 --retry-connrefused "http://127.0.0.1:${PORT:-3000}/api/health"); then
  echo "OK ($health_code)"
else
  echo "FAILED — /api/health is not answering 200 on this release" >&2
  echo "Inspect before serving traffic: journalctl -u sonvudev-store -n 50 --no-pager" >&2
  exit 1
fi

echo "Release activated: $RELEASE_ID"
