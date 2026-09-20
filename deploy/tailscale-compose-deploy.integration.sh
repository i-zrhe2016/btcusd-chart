#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/deploy/tailscale-compose-deploy.sh"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
RUN_ID="${DEPLOY_INTEGRATION_RUN_ID:-$(date -u +%Y%m%dt%H%M%Sz)-$$}"
RUN_ID="${RUN_ID,,}"
COMPOSE_PROJECT="btcusd-chart-itest-$RUN_ID"
IMAGE_NAME="btcusd-chart-itest/$RUN_ID"
ROLLBACK_MARKER="itest-rollback-marker"

if [[ "${DEPLOY_INTEGRATION:-0}" != 1 ]]; then
  printf 'skipping the real Compose integration test: set DEPLOY_INTEGRATION=1 to run it\n'
  exit 0
fi

fail() {
  printf 'integration failure: %s\n' "$*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker is required"
for required in curl jq flock git tar; do
  command -v "$required" >/dev/null 2>&1 || fail "$required is required"
done
docker info >/dev/null 2>&1 || fail "a running Docker daemon is required"
[[ -z "$(git -C "$ROOT_DIR" status --porcelain)" ]] || fail "the integration check requires a clean checkout"
[[ "$RUN_ID" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "DEPLOY_INTEGRATION_RUN_ID must be a lowercase token"

port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}

pick_port() {
  local candidate
  for _ in {1..20}; do
    candidate=$((20000 + RANDOM % 40000))
    port_in_use "$candidate" || { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}

PORT=""

if [[ -n "${DEPLOY_INTEGRATION_PORT:-}" ]]; then
  [[ "$DEPLOY_INTEGRATION_PORT" =~ ^[0-9]+$ ]] && ((10#$DEPLOY_INTEGRATION_PORT >= 1 && 10#$DEPLOY_INTEGRATION_PORT <= 65535)) || fail "DEPLOY_INTEGRATION_PORT must be between 1 and 65535"
  if port_in_use "$DEPLOY_INTEGRATION_PORT"; then
    fail "DEPLOY_INTEGRATION_PORT is already in use"
  fi
fi

REVISION_TAG="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
REVISION_IMAGE_ID=""
ROLLBACK_DIGEST=""
TMP_DIR="$(mktemp -d)"
FAKE_BIN="$TMP_DIR/bin"
mkdir -p "$FAKE_BIN" "$TMP_DIR/lock-dir"

compose() {
  COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT" docker compose -f "$COMPOSE_FILE" "$@"
}

running_container() {
  compose ps -q web
}

if [[ -n "$(compose ps -aq)" ]]; then
  fail "the disposable Compose project $COMPOSE_PROJECT already has containers"
fi
if docker image inspect "$IMAGE_NAME:rollback-tag" >/dev/null 2>&1; then
  fail "the disposable image name $IMAGE_NAME already exists"
fi

container_image_id() {
  docker inspect "$(running_container)" --format '{{.Image}}'
}

cleanup() {
  local reference
  compose down --remove-orphans >/dev/null 2>&1 || true
  for reference in "$REVISION_IMAGE_ID" "$ROLLBACK_DIGEST" "$IMAGE_NAME:$REVISION_TAG" "$IMAGE_NAME:rollback-tag"; do
    if [[ -n "$reference" ]]; then
      docker image rm -f "$reference" >/dev/null 2>&1 || true
    fi
  done
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

cat > "$FAKE_BIN/tailscale" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == ip ]]; then
  printf '127.0.0.1\n'
elif [[ "$1" == status ]]; then
  printf '{"Self":{"ID":"itest-node","HostName":"%s","Online":true},"BackendState":"Running"}\n' "$(hostname)"
else
  exit 1
fi
EOF
chmod +x "$FAKE_BIN/tailscale"

write_contract() {
  local path="$1" smoke_marker="$2"
  cat > "$path" <<EOF
TARGET_ENVIRONMENT=staging
TARGET_DESIGNATION=tailscale-hardened
TARGET_HOSTNAME=$(hostname)
EXPECTED_NODE_ID=itest-node
EXPECTED_TAILSCALE_IP=127.0.0.1
SOURCE_REVISION=$(git -C "$ROOT_DIR" rev-parse HEAD)
ROLLBACK_TAG=rollback-tag
ROLLBACK_IMAGE_DIGEST=$ROLLBACK_DIGEST
SERVICE_NAME=web
WEB_PORT=$PORT
SMOKE_MARKER=$smoke_marker
WAIT_SECONDS=120
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT
IMAGE_NAME=$IMAGE_NAME
DEPLOY_LOCK_PATH=$TMP_DIR/lock-dir
EOF
  chmod 600 "$path"
}

run_entrypoint() {
  local config="$1"
  shift
  env PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" --config "$config" "$@"
}

deploy_revision() {
  local attempt
  for attempt in 1 2; do
    PORT="$(pick_port)" || fail "could not find a free host port"
    [[ -z "${DEPLOY_INTEGRATION_PORT:-}" ]] || PORT="$DEPLOY_INTEGRATION_PORT"
    write_contract "$TMP_DIR/deploy.env" 'BTCUSD Chart'
    if run_entrypoint "$TMP_DIR/deploy.env" >"$TMP_DIR/deploy.log" 2>&1; then
      return 0
    fi
    if (( attempt == 1 )) && [[ -z "${DEPLOY_INTEGRATION_PORT:-}" ]] && grep -qE 'address already in use|port is already allocated' "$TMP_DIR/deploy.log"; then
      compose down --remove-orphans >/dev/null 2>&1 || true
      printf 'the host port was taken by another process; retrying on a new port\n'
      continue
    fi
    break
  done
  cat "$TMP_DIR/deploy.log" >&2
  fail "the checked-out revision did not deploy"
}

printf 'building the known-good rollback image\n'
ROLLBACK_SRC="$TMP_DIR/rollback-src"
mkdir -p "$ROLLBACK_SRC"
git -C "$ROOT_DIR" archive HEAD | tar -x -C "$ROLLBACK_SRC"
sed -i "s#<title>BTCUSD Chart</title>#<title>BTCUSD Chart $ROLLBACK_MARKER</title>#" "$ROLLBACK_SRC/index.html"
grep -q "$ROLLBACK_MARKER" "$ROLLBACK_SRC/index.html" || fail "could not build a distinct known-good image"
docker build -q -f "$ROLLBACK_SRC/Dockerfile" -t "$IMAGE_NAME:rollback-tag" "$ROLLBACK_SRC" >/dev/null
ROLLBACK_DIGEST="$(docker image inspect "$IMAGE_NAME:rollback-tag" --format '{{.Id}}')"
[[ "$ROLLBACK_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "rollback image ID is unavailable"

deploy_revision
REVISION_IMAGE_ID="$(docker image inspect "$IMAGE_NAME:$REVISION_TAG" --format '{{.Id}}')"
[[ "$(container_image_id)" == "$REVISION_IMAGE_ID" ]] || fail "deploy did not run the built revision image"
curl --fail --silent --max-time 10 "http://127.0.0.1:$PORT/health" | grep -q '^ok$' || fail "the deployed service did not answer the health check"
curl --fail --silent --max-time 10 "http://127.0.0.1:$PORT/workspace" | grep -q 'BTCUSD Chart' || fail "the deployed service did not answer the smoke check"

run_entrypoint "$TMP_DIR/deploy.env" --rollback >/dev/null
[[ "$(container_image_id)" == "$ROLLBACK_DIGEST" ]] || fail "explicit rollback did not restore the known-good image"

write_contract "$TMP_DIR/mismatch.env" "$ROLLBACK_MARKER"
if run_entrypoint "$TMP_DIR/mismatch.env" >"$TMP_DIR/mismatch.log" 2>&1; then
  fail "a deployment whose smoke marker never appears unexpectedly succeeded"
fi
[[ "$(container_image_id)" == "$ROLLBACK_DIGEST" ]] || fail "failed post-deploy verification did not restore the known-good image"
grep -F 'rollback verified' "$TMP_DIR/mismatch.log" >/dev/null || fail "the failed deployment did not verify its rollback"
if grep -F 'rollback was not verified' "$TMP_DIR/mismatch.log" >/dev/null; then
  fail "the failed deployment did not verify its rollback"
fi

printf 'tailscale deployment integration test passed\n'
