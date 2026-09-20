#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/deploy/tailscale-compose-deploy.sh"
REAL_DOCKER="$(command -v docker || true)"
REAL_JQ="$(command -v jq || true)"
TMP_DIR="$(mktemp -d)"
FAKE_BIN="$TMP_DIR/bin"
STATE_DIR="$TMP_DIR/state"
mkdir -p "$FAKE_BIN" "$STATE_DIR/lock-dir"

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
  case "${FAKE_TARGET_MODE:-ok}" in
    bad-ip) printf '192.0.2.3\n' ;;
    empty-ip) ;;
    multi-ip) printf '192.0.2.2\n192.0.2.9\n' ;;
    invalid-ip) printf 'not-an-address\n' ;;
    ip-error) exit 1 ;;
    *) printf '192.0.2.2\n' ;;
  esac
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

cat > "$FAKE_BIN/flock" <<'EOF'
#!/usr/bin/env bash
if [[ "${FAKE_LOCK_BUSY:-0}" == 1 ]]; then
  exit 1
fi
exec /usr/bin/flock "$@"
EOF

cat > "$FAKE_BIN/git" <<'EOF'
#!/usr/bin/env bash
source_revision="${FAKE_SOURCE_REVISION:?}"
case "$*" in
  *'status --porcelain=v1 --ignored'*)
    case "${FAKE_IGNORED_MODE:-clean}" in
      blocked) printf '!! notes.txt\n' ;;
      nested) printf '!! packages/app/node_modules/\n' ;;
      allowed) printf '!! node_modules/\n!! dist/\n!! coverage/\n!! .playwright-cli/\n!! tsconfig.app.tsbuildinfo\n!! .env.local\n!! .DS_Store\n!! .npmrc\n!! build.log\n' ;;
    esac
    exit 0
    ;;
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
    btcusd-chart:rollback-tag|"$FAKE_ROLLBACK_DIGEST")
      if [[ "${FAKE_ROLLBACK_RETAG:-0}" == 1 ]]; then
        printf 'inspected\n' >> "$FAKE_STATE_DIR/rollback-inspects"
        if (( $(wc -l < "$FAKE_STATE_DIR/rollback-inspects") > 1 )); then
          printf 'sha256:%s\n' "$(printf '3%.0s' {1..64})"
          exit 0
        fi
      fi
      printf '%s\n' "$FAKE_ROLLBACK_DIGEST"
      ;;
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
      if [[ "${FAKE_IMAGE_MISMATCH:-0}" == 1 && "$(cat "$state_file")" != btcusd-chart:rollback-tag ]]; then
        printf '%s\n' "$FAKE_ROLLBACK_DIGEST"
        exit 0
      fi
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
  *' version '*)
    [[ "${FAKE_NO_COMPOSE:-0}" != 1 ]] || exit 1
    exit 0
    ;;
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
    if [[ "${FAKE_UP_FAIL:-0}" == 1 && "$IMAGE_TAG" != rollback-tag ]]; then
      exit 1
    fi
    if [[ "${FAKE_ROLLBACK_UP_FAIL:-0}" == 1 && "$IMAGE_TAG" == rollback-tag ]]; then
      exit 1
    fi
    printf '%s\n' "$IMAGE_REFERENCE" > "$state_file"
    printf 'up %s\n' "$*" >> "$FAKE_STATE_DIR/docker.log"
    exit 0
    ;;
  *' ps -q '*)
    if [[ "${FAKE_MULTIPLE_CONTAINERS:-0}" == 1 ]]; then
      printf 'fake-container\nother-container\n'
    else
      printf 'fake-container\n'
    fi
    exit 0
    ;;
  *) exit 1 ;;
esac
EOF

cat > "$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
url="${@: -1}"
printf '%s\n' "$url" >> "$FAKE_STATE_DIR/curl.log"
running_ref="$(cat "$FAKE_STATE_DIR/running-ref" 2>/dev/null || true)"
case "$url" in
  http://192.0.2.2:8081/health) body=ok ;;
  http://192.0.2.2:8081/workspace) body='<title>BTCUSD Chart</title>' ;;
  *) exit 1 ;;
esac
if [[ "$running_ref" != btcusd-chart:rollback-tag ]]; then
  if [[ "$url" == */health && -n "${FAKE_HEALTH_BODY:-}" ]]; then
    body="$FAKE_HEALTH_BODY"
  fi
  if [[ "$url" == */workspace && -n "${FAKE_SMOKE_BODY:-}" ]]; then
    body="$FAKE_SMOKE_BODY"
  fi
fi
if [[ "${FAKE_FAIL_NEW:-0}" == 1 && "$(cat "$FAKE_STATE_DIR/running-ref" 2>/dev/null || true)" != btcusd-chart:rollback-tag ]]; then
  exit 1
fi
if [[ "${FAKE_FAIL_ROLLBACK:-0}" == 1 && "$(cat "$FAKE_STATE_DIR/running-ref" 2>/dev/null || true)" == btcusd-chart:rollback-tag ]]; then
  exit 1
fi
printf '%s\n' "$body"
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
    -e "s#DEPLOY_LOCK_PATH=LOCK_PATH_PLACEHOLDER#DEPLOY_LOCK_PATH=$STATE_DIR/lock-dir#" \
    "$1"
  chmod 600 "$1"
}

bash -n "$SCRIPT"
assert_success bash "$SCRIPT" --help
assert_failure env PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" --config "$TMP_DIR/missing" --dry-run
cp "$ROOT_DIR/deploy/tailscale.env.example" "$TMP_DIR/example.env"
assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/example.env" --dry-run

write_contract "$TMP_DIR/valid.env"
assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_NO_COMPOSE=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run

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

cp "$TMP_DIR/valid.env" "$TMP_DIR/colliding-rollback.env"
sed -i -e 's/^ROLLBACK_TAG=.*/ROLLBACK_TAG=test-commit/' -e "s#^ROLLBACK_IMAGE_DIGEST=.*#ROLLBACK_IMAGE_DIGEST=$TEST_REVISION_DIGEST#" "$TMP_DIR/colliding-rollback.env"
if env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/colliding-rollback.env" --dry-run >/dev/null 2>"$TMP_DIR/collision.stderr"; then
  fail "a rollback tag equal to the revision tag unexpectedly succeeded"
fi
grep -F 'must differ from the derived revision tag' "$TMP_DIR/collision.stderr" >/dev/null || fail "the revision tag collision was not reported"

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

if [[ -n "$REAL_DOCKER" && -n "$REAL_JQ" ]]; then
  real_rendered_image="$(IMAGE_NAME=btcusd-chart IMAGE_TAG=test-commit IMAGE_REFERENCE=btcusd-chart:test-commit WEB_BIND_ADDRESS=192.0.2.2 WEB_PORT=8081 COMPOSE_PROJECT_NAME=btcusd-chart "$REAL_DOCKER" compose -f "$ROOT_DIR/docker-compose.yml" config --format json | "$REAL_JQ" -r '.services.web.image')"
  [[ "$real_rendered_image" == btcusd-chart:test-commit ]] || fail "real Compose did not render the configured image reference"
else
  grep -F 'IMAGE_REFERENCE' "$ROOT_DIR/docker-compose.yml" >/dev/null || fail "the Compose file no longer pins the image reference"
  printf 'skipping the real Compose render check: docker or jq is unavailable\n'
fi

touch "$TMP_DIR/ignored-compose.yml"
env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" COMPOSE_FILE="$TMP_DIR/ignored-compose.yml" bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run >/dev/null

assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_DIRTY=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run

assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_IGNORED_MODE=blocked bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run
assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_IGNORED_MODE=nested bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run
env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_IGNORED_MODE=allowed bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run >/dev/null

cp "$TMP_DIR/valid.env" "$TMP_DIR/blank-marker.env"
printf 'HEALTH_MARKER= \n' >> "$TMP_DIR/blank-marker.env"
assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/blank-marker.env" --dry-run

cp "$TMP_DIR/valid.env" "$TMP_DIR/long-marker.env"
printf 'SMOKE_MARKER=%s\n' "$(printf 'x%.0s' {1..129})" >> "$TMP_DIR/long-marker.env"
assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/long-marker.env" --dry-run

cp "$TMP_DIR/valid.env" "$TMP_DIR/glob-marker.env"
printf 'SMOKE_MARKER=*BTCUSD*\n' >> "$TMP_DIR/glob-marker.env"
assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/glob-marker.env" --dry-run

cp "$TMP_DIR/valid.env" "$TMP_DIR/trailing-quote.env"
sed -i 's/^TARGET_ENVIRONMENT=.*/TARGET_ENVIRONMENT="staging"trailing/' "$TMP_DIR/trailing-quote.env"
assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/trailing-quote.env" --dry-run

cp "$TMP_DIR/valid.env" "$TMP_DIR/embedded-quote.env"
sed -i 's/^TARGET_ENVIRONMENT=.*/TARGET_ENVIRONMENT=sta"ging/' "$TMP_DIR/embedded-quote.env"
assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/embedded-quote.env" --dry-run

cp "$TMP_DIR/valid.env" "$TMP_DIR/quoted.env"
sed -i 's/^TARGET_ENVIRONMENT=.*/TARGET_ENVIRONMENT="staging"/' "$TMP_DIR/quoted.env"
assert_success env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/quoted.env" --dry-run

env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run >/dev/null
grep -F 'config' "$STATE_DIR/docker.log" >/dev/null || fail "dry-run did not validate Compose configuration"
grep -F 'config --format json' "$STATE_DIR/docker.log" >/dev/null || fail "dry-run did not validate the configured service image"
! grep -E 'build|up ' "$STATE_DIR/docker.log" >/dev/null || fail "dry-run attempted a service mutation"

assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_MISSING_ROLLBACK=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run

for mode in malformed offline bad-node bad-host bad-ip empty-ip multi-ip invalid-ip ip-error; do
  assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_TARGET_MODE="$mode" bash "$SCRIPT" --config "$TMP_DIR/valid.env" --dry-run
done

assert_failure env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_LOCK_BUSY=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env"

if env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_LOCK_BUSY=1 FAKE_DIRTY=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" >/dev/null 2>"$TMP_DIR/lock-order.stderr"; then
  fail "a busy deployment lock unexpectedly succeeded"
fi
grep -F 'already active' "$TMP_DIR/lock-order.stderr" >/dev/null || fail "the deployment lock was not acquired before revision validation"

printf 'btcusd-chart:rollback-tag\n' > "$STATE_DIR/running-ref"
env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/valid.env" >/dev/null
[[ "$(cat "$STATE_DIR/running-ref")" == btcusd-chart:test-commit ]] || fail "successful deploy did not select the revision tag"
grep -F '192.0.2.2:8081/health' "$STATE_DIR/curl.log" >/dev/null || fail "health path was not checked"
grep -F '192.0.2.2:8081/workspace' "$STATE_DIR/curl.log" >/dev/null || fail "smoke path was not checked"

cp "$TMP_DIR/valid.env" "$TMP_DIR/custom-marker.env"
printf 'HEALTH_MARKER=ready\nSMOKE_MARKER=Chart Ready\n' >> "$TMP_DIR/custom-marker.env"
printf 'btcusd-chart:rollback-tag\n' > "$STATE_DIR/running-ref"
env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_HEALTH_BODY='service is ready' FAKE_SMOKE_BODY='<title>Chart Ready</title>' bash "$SCRIPT" --config "$TMP_DIR/custom-marker.env" >/dev/null
[[ "$(cat "$STATE_DIR/running-ref")" == btcusd-chart:test-commit ]] || fail "configured markers were not accepted"

printf 'btcusd-chart:rollback-tag\n' > "$STATE_DIR/running-ref"
if env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_HEALTH_BODY='wrong body' bash "$SCRIPT" --config "$TMP_DIR/valid.env" >/dev/null 2>"$TMP_DIR/health-marker.stderr"; then
  fail "unexpected health body unexpectedly succeeded"
fi
[[ "$(cat "$STATE_DIR/running-ref")" == btcusd-chart:rollback-tag ]] || fail "unexpected health body did not restore the rollback tag"

printf 'btcusd-chart:rollback-tag\n' > "$STATE_DIR/running-ref"
if env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_SMOKE_BODY='wrong body' bash "$SCRIPT" --config "$TMP_DIR/valid.env" >/dev/null 2>"$TMP_DIR/smoke-marker.stderr"; then
  fail "unexpected smoke body unexpectedly succeeded"
fi
[[ "$(cat "$STATE_DIR/running-ref")" == btcusd-chart:rollback-tag ]] || fail "unexpected smoke body did not restore the rollback tag"

env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --config "$TMP_DIR/valid.env" --rollback >/dev/null
[[ "$(cat "$STATE_DIR/running-ref")" == btcusd-chart:rollback-tag ]] || fail "explicit rollback did not select the rollback tag"

printf 'btcusd-chart:rollback-tag\n' > "$STATE_DIR/running-ref"
if env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_UP_FAIL=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" >/dev/null 2>"$TMP_DIR/up.stderr"; then
  fail "failed compose up unexpectedly succeeded"
fi
[[ "$(cat "$STATE_DIR/running-ref")" == btcusd-chart:rollback-tag ]] || fail "compose up failure did not preserve the rollback tag"

printf 'btcusd-chart:rollback-tag\n' > "$STATE_DIR/running-ref"
if env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_FAIL_NEW=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" >/dev/null 2>"$TMP_DIR/rollback.stderr"; then
  fail "failed post-deploy verification unexpectedly succeeded"
fi
[[ "$(cat "$STATE_DIR/running-ref")" == btcusd-chart:rollback-tag ]] || fail "failed deployment did not restore the rollback tag"

printf 'btcusd-chart:rollback-tag\n' > "$STATE_DIR/running-ref"
if env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_FAIL_NEW=1 FAKE_ROLLBACK_UP_FAIL=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" >/dev/null 2>"$TMP_DIR/rollback-command.stderr"; then
  fail "rollback command failure unexpectedly succeeded"
fi
[[ "$(cat "$STATE_DIR/running-ref")" == btcusd-chart:test-commit ]] || fail "rollback command failure did not preserve the deployed tag"

printf 'btcusd-chart:rollback-tag\n' > "$STATE_DIR/running-ref"
: > "$STATE_DIR/rollback-inspects"
if env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_FAIL_NEW=1 FAKE_ROLLBACK_RETAG=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" >"$TMP_DIR/retag.log" 2>&1; then
  fail "a rollback tag that changed after validation unexpectedly succeeded"
fi
grep -F 'rollback image no longer matches ROLLBACK_IMAGE_DIGEST' "$TMP_DIR/retag.log" >/dev/null || fail "the changed rollback image was not reported"
[[ "$(cat "$STATE_DIR/running-ref")" == btcusd-chart:test-commit ]] || fail "the changed rollback image was still started"

printf 'btcusd-chart:rollback-tag\n' > "$STATE_DIR/running-ref"
if env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_FAIL_NEW=1 FAKE_FAIL_ROLLBACK=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" >/dev/null 2>"$TMP_DIR/rollback-health.stderr"; then
  fail "rollback verification failure unexpectedly succeeded"
fi
[[ "$(cat "$STATE_DIR/running-ref")" == btcusd-chart:rollback-tag ]] || fail "rollback verification failure changed the rollback tag"

printf 'btcusd-chart:rollback-tag\n' > "$STATE_DIR/running-ref"
if env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_IMAGE_MISMATCH=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" >/dev/null 2>"$TMP_DIR/image-mismatch.stderr"; then
  fail "image mismatch unexpectedly succeeded"
fi
[[ "$(cat "$STATE_DIR/running-ref")" == btcusd-chart:rollback-tag ]] || fail "image mismatch did not restore the rollback tag"

printf 'btcusd-chart:rollback-tag\n' > "$STATE_DIR/running-ref"
if env PATH="$FAKE_BIN:$PATH" FAKE_STATE_DIR="$STATE_DIR" FAKE_MULTIPLE_CONTAINERS=1 bash "$SCRIPT" --config "$TMP_DIR/valid.env" >/dev/null 2>"$TMP_DIR/multiple-containers.stderr"; then
  fail "multiple containers unexpectedly succeeded"
fi
[[ "$(cat "$STATE_DIR/running-ref")" == btcusd-chart:rollback-tag ]] || fail "multiple containers did not leave the rollback tag"

printf 'tailscale deployment tests passed\n'
