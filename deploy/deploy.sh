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
for forbidden in .env .git data logs publish-output; do
  if [[ -e "$SOURCE_DIR/$forbidden" ]]; then
    echo "ERROR: artifact contains $forbidden — refusing to deploy." >&2
    exit 1
  fi
done
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
sudo -u sonvudev npm ci --omit=dev --ignore-scripts
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
chown -h sonvudev:sonvudev "$CURRENT_LINK"
chown -R sonvudev:sonvudev "$RELEASE_DIR" "$APP_ROOT/shared"

sudo cp "$SOURCE_DIR/deploy/sonvudev-store.service" /etc/systemd/system/sonvudev-store.service
sudo systemctl daemon-reload
sudo systemctl enable --now sonvudev-store
sudo systemctl restart sonvudev-store

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
