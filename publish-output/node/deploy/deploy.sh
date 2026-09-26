#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT=/opt/sonvudev-store
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="$APP_ROOT/releases/$RELEASE_ID"
CURRENT_LINK="$APP_ROOT/current"
SOURCE_DIR="${1:-$(pwd)}"

if [[ ! -f "$SOURCE_DIR/package.json" ]]; then
  echo "ERROR: package.json not found in $SOURCE_DIR" >&2
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
rm -rf "$RELEASE_DIR/node_modules" "$RELEASE_DIR/.env" "$RELEASE_DIR/data" "$RELEASE_DIR/logs"

cd "$RELEASE_DIR"
sudo -u sonvudev npm ci --omit=dev --ignore-scripts
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
chown -h sonvudev:sonvudev "$CURRENT_LINK"
chown -R sonvudev:sonvudev "$RELEASE_DIR" "$APP_ROOT/shared"

sudo cp "$SOURCE_DIR/deploy/sonvudev-store.service" /etc/systemd/system/sonvudev-store.service
sudo systemctl daemon-reload
sudo systemctl enable --now sonvudev-store
sudo systemctl restart sonvudev-store

echo "Release activated: $RELEASE_ID"
echo "Health: curl -fsS http://127.0.0.1:3000/api/health"
