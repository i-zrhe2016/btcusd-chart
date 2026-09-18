#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/deploy/tailscale-compose-deploy.sh"
TMP_DIR="$(mktemp -d)"
FAKE_BIN="$TMP_DIR/bin"
STATE_DIR="$TMP_DIR/state"
mkdir -p "$FAKE_BIN" "$STATE_DIR"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  printf 'test failure: %s\n' "$*" >&2
  exit 1
}

assert_success() {
  "$@" >/dev/null 2>"$TMP_DIR/stderr" || fail "expected success: $*\n$(cat "$TMP_DIR/stderr")"
}

assert_failure() {
  if "$@" >/dev/null 2>"$TMP_DIR/stderr"; then
    fail "expected failure: $*"
  fi
}

cat > "$FAKE_BIN/tailscale" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == ip ]]; then
  if [[ "${FAKE_TARGET_MODE:-ok}" == bad-ip ]]; then
    printf '192.0.2.3\n'
  else
    printf '192.0.2.2\n'
  fi
elif [[ "$1" == status ]]; then
  case "${FAKE_TARGET_MODE:-ok}" in
    malformed) printf '{}\n' ;;
    offline) printf '{"Self":{"ID":"test-node","HostName":"test-host","Online":false},"BackendState":"Stopped"}\n' ;;
    bad-node) printf '{"Self":{"ID":"other-node","HostName":"test-host","Online":true},"BackendState":"Running"}\n' ;;
    bad-host) printf '{"Self":{"ID":"test-node","HostName":"other-host","Online":true},"BackendState":"Running"}\n' ;;
    *) printf '{"Self":{"ID":"test-node","HostName":"test-host","Online":true},"BackendState":"Running"}\n' ;;
  esac
else
  exit 1
fi
EOF

cat > "$FAKE_BIN/jq" <<'EOF'
#!/usr/bin/env bash
mode="${FAKE_TARGET_MODE:-ok}"
case "$*:$mode" in
  *Self.ID*:malformed) exit 0 ;;
  *Self.ID*:bad-node) printf 'other-node\n' ;;
  *Self.ID*:*) printf 'test-node\n' ;;
  *Self.HostName*:malformed) exit 0 ;;
  *Self.HostName*:bad-host) printf 'other-host\n' ;;
  *Self.HostName*:*) printf 'test-host\n' ;;
  *BackendState*:malformed) exit 0 ;;
  *BackendState*:offline) printf 'Stopped\n' ;;
  *BackendState*:*) printf 'Running\n' ;;
  *Self.Online*:malformed) exit 0 ;;
  *Self.Online*:offline) printf 'false\n' ;;
  *Self.Online*:*) printf 'true\n' ;;
  *) exit 1 ;;
esac
EOF

cat > "$FAKE_BIN/hostname" <<'EOF'
#!/usr/bin/env bash
printf 'test-host\n'
EOF

cat > "$FAKE_BIN/git" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *'rev-parse --show-toplevel'*) printf '%s\n' "$PWD" ;;
  *'rev-parse --short=12 HEAD'*) printf 'test-commit\n' ;;
  *'rev-parse HEAD'*) printf 'test-commit\n' ;;
  *'rev-parse test-commit^{commit}'*) printf 'test-commit\n' ;;
  *) exit 1 ;;
esac
EOF

cat > "$FAKE_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
state_file="$FAKE_STATE_DIR/running-tag"
if [[ "$1" == image && "$2" == inspect ]]; then
  [[ "$3" == btcusd-chart:rollback-tag ]] || exit 1
  [[ "${FAKE_MISSING_ROLLBACK:-0}" == 1 ]] && exit 1
  exit 0
fi
if [[ "$1" == inspect ]]; then
  [[ "$2" == fake-container && "$3" == --format && "$4" == "{{.Config.Image}}" ]] || exit 1
  printf 'btcusd-chart:%s\n' "$(cat "$state_file")"
  exit 0
fi
if [[ "$1" != compose ]]; then
  exit 1
fi
shift
case " $* " in
  *' config '*)
    [[ "$IMAGE_TAG" == test-commit && "$IMAGE_NAME" == btcusd-chart && "$WEB_BIND_ADDRESS" == 192.0.2.2 && "$WEB_PORT" == 8081 ]] || exit 1
    printf 'image: %s:%s\n' "$IMAGE_NAME" "$IMAGE_TAG"
    printf 'config %s\n' "$*" >> "$FAKE_STATE_DIR/docker.log"
    exit 0
    ;;
  *' build '*) printf 'build %s\n' "$*" >> "$FAKE_STATE_DIR/docker.log"; exit 0 ;;
  *' up '*) printf '%s\n' "$IMAGE_TAG" > "$state_file"; printf 'up %s\n' "$*" >> "$FAKE_STATE_DIR/docker.log"; exit 0 ;;
  *' ps -q '*) printf 'fake-container\n'; exit 0 ;;
  *) exit 1 ;;
esac
EOF

cat > "$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
url="${@: -1}"
printf '%s\n' "$url" >> "$FAKE_STATE_DIR/curl.log"
[[ "$url" == http://192.0.2.2:8081/health || "$url" == http://192.0.2.2:8081/workspace ]] || exit 1
if [[ "${FAKE_FAIL_NEW:-0}" == 1 && "$(cat "$FAKE_STATE_DIR/running-tag" 2>/dev/null || true)" != rollback-tag ]]; then
  exit 1
fi
exit 0
EOF

chmod +x "$FAKE_BIN"/*

write_contract() {
  cat > "$1" <<'EOF'
TARGET_ENVIRONMENT=staging
TARGET_DESIGNATION=tailscale-hardened
TARGET_HOSTNAME=test-host
EXPECTED_NODE_ID=test-node
EXPECTED_TAILSCALE_IP=192.0.2.2
SOURCE_REVISION=test-commit
ROLLBACK_TAG=rollback-tag
SERVICE_NAME=web
WEB_PORT=8081
HEALTH_PATH=/health
SMOKE_PATH=/workspace
WAIT_SECONDS=1
COMPOSE_PROJECT_NAME=btcusd-chart
IMAGE_NAME=btcusd-chart
DEPLOY_LOCK_PATH=LOCK_PATH_PLACEHOLDER
EOF
  sed -i "s#DEPLOY_LOCK_PATH=LOCK_PATH_PLACEHOLDER#DEPLOY_LOCK_PATH=$STATE_DIR/deploy.lock#" "$1"
}

bash -n "$SCRIPT"
assert_success bash "$SCRIPT" --help
assert_failure env PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" --config "$TMP_DIR/missing" --dry-run
cp "$ROOT_DIR/deploy/tailscale.env.example" "$TMP_DIR/example.env"
assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/example.env" --dry-run

write_contract "$TMP_DIR/valid.env"
env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run >/dev/null
grep -F 'config' "$STATE_DIR/docker.log" >/dev/null || fail "dry-run did not validate Compose configuration"
! grep -E 'build|up ' "$STATE_DIR/docker.log" >/dev/null || fail "dry-run attempted a service mutation"

assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_MISSING_ROLLBACK=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run

for mode in malformed offline bad-node bad-host bad-ip; do
  assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_TARGET_MODE="$mode" bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run
done

printf 'rollback-tag\n' > "$STATE_DIR/running-tag"
env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/valid.env" >/dev/null
[[ "$(cat "$STATE_DIR/running-tag")" == test-commit ]] || fail "successful deploy did not select the new revision"
grep -F '192.0.2.2:8081/health' "$STATE_DIR/curl.log" >/dev/null || fail "health path was not checked"
grep -F '192.0.2.2:8081/workspace' "$STATE_DIR/curl.log" >/dev/null || fail "smoke path was not checked"

env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/valid.env" --rollback >/dev/null
[[ "$(cat "$STATE_DIR/running-tag")" == rollback-tag ]] || fail "explicit rollback did not select the rollback image"

printf 'rollback-tag\n' > "$STATE_DIR/running-tag"
if env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_FAIL_NEW=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" >/dev/null 2>"$TMP_DIR/rollback.stderr"; then
  fail "failed post-deploy verification unexpectedly succeeded"
fi
[[ "$(cat "$STATE_DIR/running-tag")" == rollback-tag ]] || fail "failed deployment did not restore the rollback image"

printf 'tailscale deployment tests passed\n'
