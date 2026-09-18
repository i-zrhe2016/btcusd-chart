#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/deploy/tailscale-compose-deploy.sh"
REAL_DOCKER="$(command -v docker)"
REAL_JQ="$(command -v jq)"
TMP_DIR="$(mktemp -d)"
FAKE_BIN="$TMP_DIR/bin"
STATE_DIR="$TMP_DIR/state"
mkdir -p "$FAKE_BIN" "$STATE_DIR"

TEST_SOURCE_REVISION=0123456789abcdef0123456789abcdef01234567
TEST_ROLLBACK_DIGEST="sha256:$(printf '1%.0s' {1..64})"
TEST_REVISION_DIGEST="sha256:$(printf '2%.0s' {1..64})"
export FAKE_SOURCE_REVISION="$TEST_SOURCE_REVISION"
export FAKE_ROLLBACK_DIGEST="$TEST_ROLLBACK_DIGEST"
export FAKE_REVISION_DIGEST="$TEST_REVISION_DIGEST"
export FAKE_EXPECTED_COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"

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
if [[ "$*" == *'.services[$service].image'* ]]; then
  sed -n 's/.*"image":"\([^"]*\)".*/\1/p'
  exit 0
fi
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
source_revision="${FAKE_SOURCE_REVISION:?}"
case "$*" in
  *'status --porcelain'*)
    [[ "${FAKE_DIRTY:-0}" == 1 ]] && printf ' M file\n'
    exit 0
    ;;
  *'rev-parse --show-toplevel'*) printf '%s\n' "$PWD" ;;
  *"rev-parse ${source_revision}^{commit}"*) printf '%s\n' "$source_revision" ;;
  *'rev-parse --short=12 HEAD'*) printf 'test-commit\n' ;;
  *'rev-parse HEAD'*) printf '%s\n' "$source_revision" ;;
  *) exit 1 ;;
esac
EOF

cat > "$FAKE_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
state_file="$FAKE_STATE_DIR/running-ref"
if [[ "$1" == image && "$2" == inspect ]]; then
  [[ "$4" == --format && "$5" == "{{.Id}}" ]] || exit 1
  if [[ "${FAKE_MISSING_ROLLBACK:-0}" == 1 && ( "$3" == btcusd-chart:rollback-tag || "$3" == "$FAKE_ROLLBACK_DIGEST" ) ]]; then
    exit 1
  fi
  case "$3" in
    btcusd-chart:rollback-tag|"$FAKE_ROLLBACK_DIGEST") printf '%s\n' "$FAKE_ROLLBACK_DIGEST" ;;
    btcusd-chart:test-commit|"$FAKE_REVISION_DIGEST") printf '%s\n' "$FAKE_REVISION_DIGEST" ;;
    *) exit 1 ;;
  esac
  exit 0
fi
if [[ "$1" == inspect ]]; then
  [[ "$2" == fake-container && "$3" == --format ]] || exit 1
  case "$4" in
    "{{.Config.Image}}") cat "$state_file" ;;
    "{{.Image}}")
      if [[ "$(cat "$state_file")" == btcusd-chart:rollback-tag ]]; then
        printf '%s\n' "$FAKE_ROLLBACK_DIGEST"
      else
        printf '%s\n' "$FAKE_REVISION_DIGEST"
      fi
      ;;
    *) exit 1 ;;
  esac
  exit 0
fi
if [[ "$1" != compose ]]; then
  exit 1
fi
shift
case " $* " in
  *' config --format json '*)
    [[ "$*" == *"-f $FAKE_EXPECTED_COMPOSE_FILE"* ]] || exit 1
    printf 'config --format json %s\n' "$IMAGE_REFERENCE" >> "$FAKE_STATE_DIR/docker.log"
    printf '{"services":{"web":{"image":"btcusd-chart:%s"}}}\n' "$IMAGE_TAG"
    exit 0
    ;;
  *' config '*)
    [[ "$*" == *"-f $FAKE_EXPECTED_COMPOSE_FILE"* ]] || exit 1
    [[ "$IMAGE_TAG" == test-commit && "$IMAGE_NAME" == btcusd-chart && "$WEB_BIND_ADDRESS" == 192.0.2.2 && "$WEB_PORT" == 8081 ]] || exit 1
    printf 'config %s\n' "$*" >> "$FAKE_STATE_DIR/docker.log"
    exit 0
    ;;
  *' build '*) printf 'build %s\n' "$*" >> "$FAKE_STATE_DIR/docker.log"; exit 0 ;;
  *' up '*)
    [[ "$IMAGE_REFERENCE" == "$IMAGE_NAME:$IMAGE_TAG" ]] || exit 1
    printf '%s\n' "$IMAGE_REFERENCE" > "$state_file"
    printf 'up %s\n' "$*" >> "$FAKE_STATE_DIR/docker.log"
    exit 0
    ;;
  *' ps -q '*) printf 'fake-container\n'; exit 0 ;;
  *) exit 1 ;;
esac
EOF

cat > "$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
url="${@: -1}"
printf '%s\n' "$url" >> "$FAKE_STATE_DIR/curl.log"
[[ "$url" == http://192.0.2.2:8081/health || "$url" == http://192.0.2.2:8081/workspace ]] || exit 1
if [[ "${FAKE_FAIL_NEW:-0}" == 1 && "$(cat "$FAKE_STATE_DIR/running-ref" 2>/dev/null || true)" != btcusd-chart:rollback-tag ]]; then
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
SOURCE_REVISION=SOURCE_REVISION_PLACEHOLDER
ROLLBACK_TAG=rollback-tag
ROLLBACK_IMAGE_DIGEST=ROLLBACK_DIGEST_PLACEHOLDER
SERVICE_NAME=web
WEB_PORT=8081
HEALTH_PATH=/health
SMOKE_PATH=/workspace
WAIT_SECONDS=1
COMPOSE_PROJECT_NAME=btcusd-chart
IMAGE_NAME=btcusd-chart
DEPLOY_LOCK_PATH=LOCK_PATH_PLACEHOLDER
EOF
  sed -i \
    -e "s#SOURCE_REVISION=SOURCE_REVISION_PLACEHOLDER#SOURCE_REVISION=$TEST_SOURCE_REVISION#" \
    -e "s#ROLLBACK_IMAGE_DIGEST=ROLLBACK_DIGEST_PLACEHOLDER#ROLLBACK_IMAGE_DIGEST=$TEST_ROLLBACK_DIGEST#" \
    -e "s#DEPLOY_LOCK_PATH=LOCK_PATH_PLACEHOLDER#DEPLOY_LOCK_PATH=$STATE_DIR/deploy.lock#" \
    "$1"
  chmod 600 "$1"
}

bash -n "$SCRIPT"
assert_success bash "$SCRIPT" --help
assert_failure env PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" --config "$TMP_DIR/missing" --dry-run
cp "$ROOT_DIR/deploy/tailscale.env.example" "$TMP_DIR/example.env"
assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/example.env" --dry-run

write_contract "$TMP_DIR/valid.env"
cp "$TMP_DIR/valid.env" "$TMP_DIR/insecure.env"
chmod 644 "$TMP_DIR/insecure.env"
assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/insecure.env" --dry-run

ln -s "$TMP_DIR/valid.env" "$TMP_DIR/symlink.env"
assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/symlink.env" --dry-run

cp "$TMP_DIR/valid.env" "$TMP_DIR/duplicate.env"
printf 'TARGET_ENVIRONMENT=production\n' >> "$TMP_DIR/duplicate.env"
assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/duplicate.env" --dry-run

cp "$TMP_DIR/valid.env" "$TMP_DIR/mutable.env"
sed -i 's/^SOURCE_REVISION=.*/SOURCE_REVISION=main/' "$TMP_DIR/mutable.env"
assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/mutable.env" --dry-run

ln -s "$STATE_DIR/lock-target" "$STATE_DIR/lock-link"
cp "$TMP_DIR/valid.env" "$TMP_DIR/lock-symlink.env"
sed -i "s#^DEPLOY_LOCK_PATH=.*#DEPLOY_LOCK_PATH=$STATE_DIR/lock-link#" "$TMP_DIR/lock-symlink.env"
assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/lock-symlink.env" --dry-run

cp "$TMP_DIR/valid.env" "$TMP_DIR/wait-eight.env"
sed -i 's/^WAIT_SECONDS=.*/WAIT_SECONDS=08/' "$TMP_DIR/wait-eight.env"
assert_success env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/wait-eight.env" --dry-run

cp "$TMP_DIR/valid.env" "$TMP_DIR/default-lock.env"
sed -i '/^DEPLOY_LOCK_PATH=/d' "$TMP_DIR/default-lock.env"
if [[ -d /run/btcusd-chart && "$(stat -c '%u' /run/btcusd-chart)" == "$(id -u)" ]]; then
  assert_success env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/default-lock.env" --dry-run
else
  assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/default-lock.env" --dry-run
fi

real_rendered_image="$(IMAGE_NAME=btcusd-chart IMAGE_TAG=test-commit IMAGE_REFERENCE=btcusd-chart:test-commit WEB_BIND_ADDRESS=192.0.2.2 WEB_PORT=8081 COMPOSE_PROJECT_NAME=btcusd-chart "$REAL_DOCKER" compose -f "$ROOT_DIR/docker-compose.yml" config --format json | "$REAL_JQ" -r '.services.web.image')"
[[ "$real_rendered_image" == btcusd-chart:test-commit ]] || fail "real Compose did not render the configured image reference"

touch "$TMP_DIR/ignored-compose.yml"
env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" COMPOSE_FILE="$TMP_DIR/ignored-compose.yml" bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run >/dev/null

assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_DIRTY=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run

env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run >/dev/null
grep -F 'config' "$STATE_DIR/docker.log" >/dev/null || fail "dry-run did not validate Compose configuration"
grep -F 'config --format json' "$STATE_DIR/docker.log" >/dev/null || fail "dry-run did not validate the configured service image"
! grep -E 'build|up ' "$STATE_DIR/docker.log" >/dev/null || fail "dry-run attempted a service mutation"

assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_MISSING_ROLLBACK=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run

for mode in malformed offline bad-node bad-host bad-ip; do
  assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_TARGET_MODE="$mode" bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run
done

printf 'btcusd-chart:rollback-tag\n' > "$STATE_DIR/running-ref"
env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/valid.env" >/dev/null
[[ "$(cat "$STATE_DIR/running-ref")" == btcusd-chart:test-commit ]] || fail "successful deploy did not select the revision tag"
grep -F '192.0.2.2:8081/health' "$STATE_DIR/curl.log" >/dev/null || fail "health path was not checked"
grep -F '192.0.2.2:8081/workspace' "$STATE_DIR/curl.log" >/dev/null || fail "smoke path was not checked"

env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/valid.env" --rollback >/dev/null
[[ "$(cat "$STATE_DIR/running-ref")" == btcusd-chart:rollback-tag ]] || fail "explicit rollback did not select the rollback tag"

printf 'btcusd-chart:rollback-tag\n' > "$STATE_DIR/running-ref"
if env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_FAIL_NEW=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" >/dev/null 2>"$TMP_DIR/rollback.stderr"; then
  fail "failed post-deploy verification unexpectedly succeeded"
fi
[[ "$(cat "$STATE_DIR/running-ref")" == btcusd-chart:rollback-tag ]] || fail "failed deployment did not restore the rollback tag"

printf 'tailscale deployment tests passed\n'
