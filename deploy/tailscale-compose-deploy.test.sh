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
  printf '192.0.2.2\n'
elif [[ "$1" == status ]]; then
  printf '{"Self":{"ID":"test-node","HostName":"test-host","Online":true},"BackendState":"Running"}\n'
else
  exit 1
fi
EOF

cat > "$FAKE_BIN/jq" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *Self.ID*) printf 'test-node\n' ;;
  *Self.HostName*) printf 'test-host\n' ;;
  *BackendState*) printf 'Running\n' ;;
  *Self.Online*) printf 'true\n' ;;
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
  exit 0
fi
if [[ "$1" == inspect ]]; then
  printf 'btcusd-chart:%s\n' "$(cat "$state_file")"
  exit 0
fi
if [[ "$1" != compose ]]; then
  exit 1
fi
shift
case " $* " in
  *' config '*) exit 0 ;;
  *' build '*) exit 0 ;;
  *' up '*) printf '%s\n' "$IMAGE_TAG" > "$state_file"; exit 0 ;;
  *' ps -q '*) printf 'fake-container\n'; exit 0 ;;
  *) exit 1 ;;
esac
EOF

cat > "$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
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
EOF
}

bash -n "$SCRIPT"
assert_success bash "$SCRIPT" --help
assert_failure env PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" --config "$TMP_DIR/missing" --dry-run
cp "$ROOT_DIR/deploy/tailscale.env.example" "$TMP_DIR/example.env"
assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/example.env" --dry-run

write_contract "$TMP_DIR/valid.env"
env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run >/dev/null

printf 'rollback-tag\n' > "$STATE_DIR/running-tag"
env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/valid.env" >/dev/null
[[ "$(cat "$STATE_DIR/running-tag")" == test-commit ]] || fail "successful deploy did not select the new revision"

env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/valid.env" --rollback >/dev/null
[[ "$(cat "$STATE_DIR/running-tag")" == rollback-tag ]] || fail "explicit rollback did not select the rollback image"

printf 'rollback-tag\n' > "$STATE_DIR/running-tag"
if env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_FAIL_NEW=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" >/dev/null 2>"$TMP_DIR/rollback.stderr"; then
  fail "failed post-deploy verification unexpectedly succeeded"
fi
[[ "$(cat "$STATE_DIR/running-tag")" == rollback-tag ]] || fail "failed deployment did not restore the rollback image"

printf 'tailscale deployment tests passed\n'
