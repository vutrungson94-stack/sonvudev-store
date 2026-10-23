#!/usr/bin/env bash
# Canary rollout for the VPS deploy.
#
#   deploy/canary.sh start [percent] [artifact]   deploy a candidate beside stable
#   deploy/canary.sh split <percent>              widen or narrow the rollout
#   deploy/canary.sh promote                      make the candidate the stable build
#   deploy/canary.sh rollback                     stop the candidate, all traffic stable
#   deploy/canary.sh status                       show the current state
#
# The split is a cookie decision, not a proxy weight: src/canary.js gives each
# visitor a deterministic bucket, sets svd_canary=1, and deploy/Caddyfile.canary
# routes that cookie to the candidate port. The percentage lives in
# /etc/sonvudev-store.canary, which both instances re-read every five seconds -
# so widening 5% -> 25% -> 100% needs no restart and no dropped request.
#
# Stable is never replaced by `start`. `promote` is the only command that moves
# the `current` symlink, and it is also the only one that restarts the stable
# service. Run it after the candidate has been healthy at 100% for long enough.
set -Eeuo pipefail
umask 022

APP_ROOT=/opt/sonvudev-store
RELEASE_ROOT="$APP_ROOT/releases"
CANARY_ROOT="$APP_ROOT/canary-releases"
CURRENT_LINK="$APP_ROOT/current"
CANARY_LINK="$APP_ROOT/canary"
ENV_FILE=/etc/sonvudev-store.env
STATE_FILE=/etc/sonvudev-store.canary
PREVIOUS_FILE=/etc/sonvudev-store.canary.previous
CADDYFILE=/etc/caddy/Caddyfile
CADDY_BACKUP=/etc/caddy/Caddyfile.stable
UNIT=/etc/systemd/system/sonvudev-store-canary.service
SERVICE=sonvudev-store-canary

usage() {
  cat <<'EOF'
Canary rollout for the VPS deploy.

  deploy/canary.sh start [percent] [artifact]   deploy a candidate beside stable
  deploy/canary.sh split <percent>              widen or narrow the rollout
  deploy/canary.sh promote                      make the candidate the stable build
  deploy/canary.sh rollback                     stop the candidate, all traffic stable
  deploy/canary.sh status                       show the current state

The percentage lives in /etc/sonvudev-store.canary and is re-read every five
seconds, so split needs no restart. start never replaces stable; promote does.
EOF
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_root() {
  [[ "${EUID}" -eq 0 ]] || die "run as root: sudo bash $0 $*"
}

env_value() {
  # Last assignment wins, matching systemd's EnvironmentFile behaviour. Quoted
  # values are unquoted here; none of the values this script reads (PORT,
  # CANARY_PORT, SITE_DOMAIN) are expected to contain spaces or quotes.
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" 2>/dev/null | tail -n 1 | tr -d '"' | tr -d "'"
}

valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( $1 >= 1 && $1 <= 65535 ))
}

valid_percent() {
  [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]] && awk -v n="$1" 'BEGIN { exit !(n >= 0 && n <= 100) }'
}

write_percent() {
  local percent="$1"
  printf '%s\n' "$percent" > "${STATE_FILE}.tmp"
  chmod 0644 "${STATE_FILE}.tmp"
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
}

wait_health() {
  local port="$1" tries="${2:-15}"
  local i
  for ((i = 1; i <= tries; i += 1)); do
    if curl -fsS -o /dev/null "http://127.0.0.1:${port}/api/health"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

caddy_reload() {
  if ! caddy validate --config "$CADDYFILE" >/dev/null 2>&1; then
    echo "ERROR: $CADDYFILE is not valid; proxy left on its previous configuration." >&2
    return 1
  fi
  systemctl reload caddy
}

restore_stable_caddy() {
  if [[ -f "$CADDY_BACKUP" ]]; then
    install -m 0644 "$CADDY_BACKUP" "$CADDYFILE"
  else
    die "$CADDY_BACKUP is missing - run deploy.sh once before rolling back, or restore $CADDYFILE by hand."
  fi
  caddy_reload
}

check_artifact() {
  local source="$1"
  [[ -f "$source/package.json" ]] || die "$source is not a deployable artifact (no package.json). Run 'npm run build' first."
  local forbidden
  for forbidden in .env .git data logs publish-output .wrangler .gbuildcache; do
    [[ -e "$source/$forbidden" ]] && die "artifact contains $forbidden - refusing to deploy."
  done
  compgen -G "$source/.env.*" >/dev/null && die "artifact contains a .env.* backup - refusing to deploy."
  [[ -f "$source/deploy/sonvudev-store-canary.service.in" ]] || die "artifact has no deploy/sonvudev-store-canary.service.in."
  [[ -f "$source/deploy/Caddyfile.canary" ]] || die "artifact has no deploy/Caddyfile.canary."
}

default_artifact() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  printf '%s\n' "$here/publish-output/node"
}

cmd_start() {
  local percent="${1:-10}"
  local source="${2:-$(default_artifact)}"
  valid_percent "$percent" || die "percent must be a number between 0 and 100."
  require_root start
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE is missing. Configure production secrets first (deploy/sonvudev-store.env.example)."
  check_artifact "$source"

  local stable_port canary_port
  stable_port="$(env_value PORT)"; stable_port="${stable_port:-3000}"
  canary_port="$(env_value CANARY_PORT)"; canary_port="${canary_port:-3001}"
  valid_port "$canary_port" || die "CANARY_PORT in $ENV_FILE is not a usable port."
  [[ "$canary_port" != "$stable_port" ]] || die "CANARY_PORT must differ from PORT ($stable_port)."

  echo -n "Stable health: "
  if wait_health "$stable_port" 5; then echo "OK"; else die "stable instance is not healthy on port $stable_port; fix it before rolling out a candidate."; fi

  id sonvudev >/dev/null 2>&1 || useradd --system --home "$APP_ROOT" --shell /usr/sbin/nologin sonvudev
  install -d -o sonvudev -g sonvudev -m 0755 "$APP_ROOT" "$RELEASE_ROOT" "$CANARY_ROOT" "$APP_ROOT/shared"

  local release_id release_dir
  release_id="$(date -u +%Y%m%d%H%M%S)"
  release_dir="$CANARY_ROOT/$release_id"
  install -d -o sonvudev -g sonvudev -m 0755 "$release_dir"
  cp -a "$source"/. "$release_dir"/
  su -s /bin/bash sonvudev -c "cd '$release_dir' && npm ci --omit=dev --ignore-scripts"
  ln -sfn "$release_dir" "$CANARY_LINK"
  chown -h sonvudev:sonvudev "$CANARY_LINK"
  chown -R sonvudev:sonvudev "$release_dir" "$APP_ROOT/shared"

  # Remember what stable was pointing at, so a failed promote can be undone
  # without rebuilding anything.
  readlink -f "$CURRENT_LINK" > "$PREVIOUS_FILE" 2>/dev/null || true
  chmod 0644 "$PREVIOUS_FILE" 2>/dev/null || true

  sed "s/__CANARY_PORT__/${canary_port}/g" "$source/deploy/sonvudev-store-canary.service.in" > "$UNIT"
  chmod 0644 "$UNIT"
  systemctl daemon-reload
  systemctl enable "$SERVICE" >/dev/null
  systemctl restart "$SERVICE"

  echo -n "Canary health: "
  if ! wait_health "$canary_port"; then
    echo "FAILED"
    journalctl -u "$SERVICE" -n 40 --no-pager || true
    systemctl disable --now "$SERVICE" >/dev/null 2>&1 || true
    die "candidate did not become healthy; stable is still serving and Caddy was not changed."
  fi
  echo "OK (port $canary_port)"

  # Only now touch the proxy. A candidate that fails its own health check must
  # never receive a single visitor. Keep the last genuine stable config: running
  # start twice must not back up a Caddyfile that already has the canary route.
  if ! grep -q '@canary' "$CADDYFILE" 2>/dev/null; then
    install -m 0644 "$CADDYFILE" "$CADDY_BACKUP"
  fi
  [[ -f "$CADDY_BACKUP" ]] || die "$CADDY_BACKUP is missing; cannot restore stable after a failed reload."
  install -m 0644 "$source/deploy/Caddyfile.canary" "$CADDYFILE"
  write_percent "$percent"
  if ! caddy_reload; then
    write_percent 0
    install -m 0644 "$CADDY_BACKUP" "$CADDYFILE"
    caddy_reload || true
    systemctl disable --now "$SERVICE" >/dev/null 2>&1 || true
    die "Caddy rejected the canary route; stable configuration restored."
  fi

  echo "Rollout: ${percent}% of new visitors -> canary ($release_id)"
  echo "Existing visitors keep the channel they already have."
  echo "Next: deploy/canary.sh status | split 25 | promote | rollback"
}

cmd_split() {
  local percent="${1:-}"
  [[ -n "$percent" ]] || die "usage: $0 split <percent>"
  valid_percent "$percent" || die "percent must be a number between 0 and 100."
  require_root split
  write_percent "$percent"
  echo "Rollout is now ${percent}% for new visitors (both instances pick this up within 5 seconds)."
  if ! grep -q '@canary' "$CADDYFILE" 2>/dev/null; then
    echo "NOTE: the live Caddyfile has no canary route. Run '$0 start' to enable it." >&2
  fi
}

cmd_promote() {
  require_root promote
  command -v curl >/dev/null 2>&1 || die "curl is required."
  local stable_port canary_port
  stable_port="$(env_value PORT)"; stable_port="${stable_port:-3000}"
  canary_port="$(env_value CANARY_PORT)"; canary_port="${canary_port:-3001}"

  [[ -L "$CANARY_LINK" ]] || die "no canary release is installed."
  systemctl is-active --quiet "$SERVICE" || die "canary service is not running; nothing to promote."
  wait_health "$canary_port" 5 || die "canary is not healthy on port $canary_port."

  local target
  target="$(readlink -f "$CANARY_LINK")"
  [[ -d "$target" ]] || die "canary release directory $target is missing."

  write_percent 0
  restore_stable_caddy

  ln -sfn "$target" "$CURRENT_LINK"
  chown -h sonvudev:sonvudev "$CURRENT_LINK"
  chown -R sonvudev:sonvudev "$target" "$APP_ROOT/shared"

  systemctl restart sonvudev-store
  echo -n "Stable health after promote: "
  if ! wait_health "$stable_port"; then
    echo "FAILED"
    journalctl -u sonvudev-store -n 40 --no-pager || true
    if [[ -s "$PREVIOUS_FILE" ]]; then
      echo "Restoring the previous stable release ..." >&2
      ln -sfn "$(cat "$PREVIOUS_FILE")" "$CURRENT_LINK"
      systemctl restart sonvudev-store || true
      wait_health "$stable_port" 10 || true
      echo "Previous release restored; stable health may still be degraded - inspect now." >&2
    fi
    die "promote failed; canary was NOT removed."
  fi
  echo "OK"

  systemctl disable --now "$SERVICE" >/dev/null 2>&1 || true
  rm -f "$CANARY_LINK" "$STATE_FILE" "$PREVIOUS_FILE"
  echo "Promoted $target"
  echo "Canary stopped. Caddy is back on the stable configuration."
}

cmd_rollback() {
  require_root rollback
  local stable_port
  stable_port="$(env_value PORT)"; stable_port="${stable_port:-3000}"
  write_percent 0
  restore_stable_caddy
  systemctl disable --now "$SERVICE" >/dev/null 2>&1 || true
  rm -f "$CANARY_LINK" "$STATE_FILE" "$PREVIOUS_FILE"
  if wait_health "$stable_port" 5; then
    echo "Rolled back: all traffic is on the stable instance (port $stable_port)."
  else
    echo "Rolled back the canary, but the stable instance is not healthy on port $stable_port." >&2
    echo "Inspect: journalctl -u sonvudev-store -n 50 --no-pager" >&2
    exit 1
  fi
}

cmd_status() {
  local stable_port canary_port percent
  stable_port="$(env_value PORT)"; stable_port="${stable_port:-3000}"
  canary_port="$(env_value CANARY_PORT)"; canary_port="${canary_port:-3001}"
  percent="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"

  echo "Rollout:    ${percent}% of new visitors"
  echo "Canary:     $(systemctl is-active "$SERVICE" 2>/dev/null || true) (port $canary_port)"
  echo "Stable:     $(systemctl is-active sonvudev-store 2>/dev/null || true) (port $stable_port)"
  echo -n "Health:     stable "
  if curl -fsS -o /dev/null "http://127.0.0.1:${stable_port}/api/health" 2>/dev/null; then echo -n "OK"; else echo -n "FAIL"; fi
  echo -n ", canary "
  if curl -fsS -o /dev/null "http://127.0.0.1:${canary_port}/api/health" 2>/dev/null; then echo "OK"; else echo "FAIL"; fi
  if grep -q '@canary' "$CADDYFILE" 2>/dev/null; then
    echo "Caddy:      canary route installed"
  else
    echo "Caddy:      stable configuration"
  fi
}

command="${1:-}"
[[ $# -gt 0 ]] && shift || true

case "$command" in
  start) cmd_start "$@" ;;
  split) cmd_split "$@" ;;
  promote) cmd_promote ;;
  rollback) cmd_rollback ;;
  status) cmd_status ;;
  ""|-h|--help|help) usage ;;
  *) usage >&2; exit 2 ;;
esac
