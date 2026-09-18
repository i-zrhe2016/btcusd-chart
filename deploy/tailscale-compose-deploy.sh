#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
CONFIG_PATH="${DEPLOYMENT_CONFIG:-/etc/btcusd-chart/tailscale.env}"
MODE=deploy
DRY_RUN=0
DEPLOY_STARTED=0
ROLLING_BACK=0

usage() {
  cat <<'EOF'
Usage: tailscale-compose-deploy.sh [options]

Deploy the checked-out immutable revision to the configured Tailscale-bound
Compose service, verify it, and roll back once on a failed post-deploy check.

Options:
  --config PATH  Use an external deployment contract file.
  --dry-run      Validate the contract and rendered Compose configuration only.
  --rollback     Restore the contract's known-good image and verify it.
  --help         Show this help.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[tailscale-deploy] %s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

valid_ipv4() {
  local ip="$1" octet
  local -a octets
  IFS=. read -r -a octets <<< "$ip"
  [[ ${#octets[@]} -eq 4 ]] || return 1
  for octet in "${octets[@]}"; do
    [[ "$octet" =~ ^[0-9]+$ ]] || return 1
    ((10#$octet <= 255)) || return 1
  done
}

valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535))
}

valid_tag() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] && [[ "$1" != latest ]]
}

valid_path() {
  [[ "$1" == /* ]] && [[ "$1" != *'..'* ]] && [[ "$1" != *' '* ]]
}

load_contract() {
  [[ -r "$CONFIG_PATH" ]] || die "deployment contract not readable: $CONFIG_PATH"

  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || die "invalid contract line"

    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "invalid contract key: $key"
    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi

    case "$key" in
      TARGET_ENVIRONMENT|TARGET_DESIGNATION|TARGET_HOSTNAME|EXPECTED_NODE_ID|EXPECTED_TAILSCALE_IP|SOURCE_REVISION|ROLLBACK_TAG|SERVICE_NAME|WEB_PORT|HEALTH_PATH|SMOKE_PATH|WAIT_SECONDS|COMPOSE_PROJECT_NAME|IMAGE_NAME)
        printf -v "$key" '%s' "$value"
        ;;
      *)
        die "unsupported contract key: $key"
        ;;
    esac
  done < "$CONFIG_PATH"
}

require_contract_value() {
  local key="$1"
  [[ -n "${!key:-}" ]] || die "missing contract value: $key"
}

validate_contract() {
  local key
  for key in TARGET_ENVIRONMENT TARGET_DESIGNATION TARGET_HOSTNAME EXPECTED_NODE_ID EXPECTED_TAILSCALE_IP SOURCE_REVISION ROLLBACK_TAG; do
    require_contract_value "$key"
  done

  case "$TARGET_ENVIRONMENT" in
    local|development|staging|production) ;;
    *) die "unsupported target environment: $TARGET_ENVIRONMENT" ;;
  esac
  [[ "$TARGET_DESIGNATION" == tailscale-hardened ]] || die "Tailscale deployment requires TARGET_DESIGNATION=tailscale-hardened"
  valid_ipv4 "$EXPECTED_TAILSCALE_IP" || die "invalid EXPECTED_TAILSCALE_IP"
  valid_port "$WEB_PORT" || die "invalid WEB_PORT"
  valid_tag "$ROLLBACK_TAG" || die "invalid ROLLBACK_TAG"
  valid_path "$HEALTH_PATH" || die "invalid HEALTH_PATH"
  valid_path "$SMOKE_PATH" || die "invalid SMOKE_PATH"
  [[ "$WAIT_SECONDS" =~ ^[0-9]+$ ]] && ((WAIT_SECONDS >= 1 && WAIT_SECONDS <= 300)) || die "invalid WAIT_SECONDS"
  [[ "$SERVICE_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "invalid SERVICE_NAME"
  [[ "$COMPOSE_PROJECT_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "invalid COMPOSE_PROJECT_NAME"
  [[ "$IMAGE_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*(/[A-Za-z0-9][A-Za-z0-9_.-]*)?$ ]] || die "invalid IMAGE_NAME"
  [[ "$SOURCE_REVISION" != latest ]] || die "SOURCE_REVISION cannot be latest"
}

discover_target() {
  ACTUAL_HOSTNAME="$(hostname)"
  [[ "$ACTUAL_HOSTNAME" == "$TARGET_HOSTNAME" ]] || die "hostname mismatch: expected $TARGET_HOSTNAME, got $ACTUAL_HOSTNAME"

  ACTUAL_TAILSCALE_IP="$(tailscale ip -4 | head -n 1)"
  [[ "$ACTUAL_TAILSCALE_IP" == "$EXPECTED_TAILSCALE_IP" ]] || die "Tailscale IPv4 mismatch"

  local status_json
  status_json="$(tailscale status --json)"
  ACTUAL_NODE_ID="$(jq -r '.Self.ID // empty' <<< "$status_json")"
  ACTUAL_TAILSCALE_HOSTNAME="$(jq -r '.Self.HostName // empty' <<< "$status_json")"
  ACTUAL_BACKEND_STATE="$(jq -r '.BackendState // empty' <<< "$status_json")"
  ACTUAL_ONLINE="$(jq -r '.Self.Online // false' <<< "$status_json")"
  [[ -n "$ACTUAL_NODE_ID" && "$ACTUAL_NODE_ID" == "$EXPECTED_NODE_ID" ]] || die "Tailscale node identity mismatch"
  [[ -n "$ACTUAL_TAILSCALE_HOSTNAME" && "$ACTUAL_TAILSCALE_HOSTNAME" == "$TARGET_HOSTNAME" ]] || die "Tailscale hostname mismatch"
  [[ "$ACTUAL_BACKEND_STATE" == Running && "$ACTUAL_ONLINE" == true ]] || die "Tailscale is not online"
}

discover_revision() {
  CURRENT_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  EXPECTED_SHA="$(git -C "$ROOT_DIR" rev-parse "${SOURCE_REVISION}^{commit}" 2>/dev/null)" || die "SOURCE_REVISION is not a commit in this checkout"
  [[ "$CURRENT_SHA" == "$EXPECTED_SHA" ]] || die "checked-out revision does not match SOURCE_REVISION"
  REVISION_TAG="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
  valid_tag "$REVISION_TAG" || die "derived revision tag is invalid"
}

compose() {
  local image_tag="$1"
  shift
  ( \
    cd "$ROOT_DIR" && \
    IMAGE_TAG="$image_tag" \
    WEB_BIND_ADDRESS="$ACTUAL_TAILSCALE_IP" \
    WEB_PORT="$WEB_PORT" \
    COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
    docker compose -f "$COMPOSE_FILE" "$@" \
  )
}

verify_image() {
  local expected_tag="$1" container_id actual_image
  container_id="$(compose "$expected_tag" ps -q "$SERVICE_NAME" | head -n 1)"
  [[ -n "$container_id" ]] || return 1
  actual_image="$(docker inspect "$container_id" --format '{{.Config.Image}}')"
  [[ "$actual_image" == "$IMAGE_NAME:$expected_tag" ]]
}

wait_for_service() {
  local base_url="http://${ACTUAL_TAILSCALE_IP}:${WEB_PORT}" attempt
  for ((attempt = 1; attempt <= WAIT_SECONDS; attempt++)); do
    if curl --fail --silent --show-error --max-time 5 "$base_url$HEALTH_PATH" >/dev/null \
      && curl --fail --silent --show-error --max-time 5 "$base_url$SMOKE_PATH" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

rollback() {
  ROLLING_BACK=1
  log "rolling back to $IMAGE_NAME:$ROLLBACK_TAG"
  if ! compose "$ROLLBACK_TAG" up -d --no-build "$SERVICE_NAME"; then
    log "rollback command failed"
    return 1
  fi
  if ! wait_for_service || ! verify_image "$ROLLBACK_TAG"; then
    log "rollback verification failed"
    return 1
  fi
  log "rollback verified"
  return 0
}

on_exit() {
  local status=$?
  trap - EXIT
  if ((status != 0 && DEPLOY_STARTED == 1 && ROLLING_BACK == 0)); then
    if ! rollback; then
      log "deployment failed and rollback was not verified"
    fi
  fi
  exit "$status"
}

parse_args() {
  while (($# > 0)); do
    case "$1" in
      --config)
        (($# >= 2)) || die "--config requires a path"
        CONFIG_PATH="$2"
        shift 2
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --rollback)
        MODE=rollback
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        die "unknown argument: $1"
        ;;
    esac
  done
}

main() {
  parse_args "$@"
  load_contract

  : "${SERVICE_NAME:=web}"
  : "${WEB_PORT:=8080}"
  : "${HEALTH_PATH:=/health}"
  : "${SMOKE_PATH:=/workspace}"
  : "${WAIT_SECONDS:=30}"
  : "${COMPOSE_PROJECT_NAME:=btcusd-chart}"
  : "${IMAGE_NAME:=btcusd-chart}"

  require_command hostname
  require_command tailscale
  require_command jq
  require_command git
  require_command docker
  require_command curl
  require_command head
  require_command sleep

  validate_contract
  discover_target
  discover_revision

  docker image inspect "$IMAGE_NAME:$ROLLBACK_TAG" >/dev/null 2>&1 || die "rollback image is not available: $IMAGE_NAME:$ROLLBACK_TAG"
  compose "$REVISION_TAG" config >/dev/null || die "Compose configuration is invalid"

  log "target=$TARGET_HOSTNAME address=$ACTUAL_TAILSCALE_IP port=$WEB_PORT revision=$REVISION_TAG rollback=$ROLLBACK_TAG"
  if ((DRY_RUN == 1)); then
    log "dry-run: would build $IMAGE_NAME:$REVISION_TAG and update service $SERVICE_NAME"
    log "dry-run: failed health or smoke verification would restore $IMAGE_NAME:$ROLLBACK_TAG"
    return 0
  fi

  if [[ "$MODE" == rollback ]]; then
    DEPLOY_STARTED=1
    rollback
    return 0
  fi

  log "building $IMAGE_NAME:$REVISION_TAG"
  compose "$REVISION_TAG" build --pull=false "$SERVICE_NAME"
  DEPLOY_STARTED=1
  log "starting service $SERVICE_NAME"
  compose "$REVISION_TAG" up -d --no-build "$SERVICE_NAME"
  log "waiting for health and smoke checks"
  wait_for_service || die "post-deploy health or smoke check failed"
  verify_image "$REVISION_TAG" || die "running image does not match the requested revision"
  log "deployment verified"
}

trap on_exit EXIT
main "$@"
