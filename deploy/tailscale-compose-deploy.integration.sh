#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/deploy/tailscale-compose-deploy.sh"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
COMPOSE_PROJECT="btcusd-chart-itest"
IMAGE_NAME="btcusd-chart-itest"

if [[ "${DEPLOY_INTEGRATION:-0}" != 1 ]]; then
  printf 'skipping the real Compose integration test: set DEPLOY_INTEGRATION=1 to run it\n'
  exit 0
fi

fail() {
  printf 'integration failure: %s\n' "$*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker is required"
docker info >/dev/null 2>&1 || fail "a running Docker daemon is required"

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

PORT="${DEPLOY_INTEGRATION_PORT:-$(pick_port)}" || fail "could not find a free port"

REVISION_TAG="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
TMP_DIR="$(mktemp -d)"
FAKE_BIN="$TMP_DIR/bin"
mkdir -p "$FAKE_BIN" "$TMP_DIR/lock-dir"

compose() {
  COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT" docker compose -f "$COMPOSE_FILE" "$@"
}

running_container() {
  compose ps -q web
}

container_image_id() {
  docker inspect "$(running_container)" --format '{{.Image}}'
}

cleanup() {
  compose down --remove-orphans >/dev/null 2>&1 || true
  docker image rm -f "$IMAGE_NAME:$REVISION_TAG" "$IMAGE_NAME:rollback-tag" >/dev/null 2>&1 || true
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
  env PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" --config "$1"
}

printf 'building the known-good rollback image\n'
IMAGE_NAME="$IMAGE_NAME" IMAGE_TAG=rollback-tag COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT" \
  docker compose -f "$COMPOSE_FILE" build --pull=false web >/dev/null
ROLLBACK_DIGEST="$(docker image inspect "$IMAGE_NAME:rollback-tag" --format '{{.Id}}')"
[[ "$ROLLBACK_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "rollback image ID is unavailable"

write_contract "$TMP_DIR/deploy.env" 'BTCUSD Chart'
run_entrypoint "$TMP_DIR/deploy.env" >/dev/null
[[ "$(docker inspect "$(running_container)" --format '{{.Config.Image}}')" == "$IMAGE_NAME:$REVISION_TAG" ]] || fail "deploy did not run the built revision image"
curl --fail --silent --max-time 10 "http://127.0.0.1:$PORT/health" | grep -q '^ok$' || fail "the deployed service did not answer the health check"
curl --fail --silent --max-time 10 "http://127.0.0.1:$PORT/workspace" | grep -q 'BTCUSD Chart' || fail "the deployed service did not answer the smoke check"

run_entrypoint "$TMP_DIR/deploy.env" --rollback >/dev/null
[[ "$(container_image_id)" == "$ROLLBACK_DIGEST" ]] || fail "explicit rollback did not restore the known-good image"

write_contract "$TMP_DIR/mismatch.env" 'absent-marker-token'
if run_entrypoint "$TMP_DIR/mismatch.env" >/dev/null 2>&1; then
  fail "a deployment whose smoke marker never appears unexpectedly succeeded"
fi
[[ "$(container_image_id)" == "$ROLLBACK_DIGEST" ]] || fail "failed post-deploy verification did not restore the known-good image"

printf 'tailscale deployment integration test passed\n'
