#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
CONFIG_PATH="${DEPLOYMENT_CONFIG:-/etc/btcusd-chart/tailscale.env}"
MODE=deploy
DRY_RUN=0
DEPLOY_STARTED=0
ROLLING_BACK=0
LOCK_HELD=0

TARGET_ENVIRONMENT=""
TARGET_DESIGNATION=""
TARGET_HOSTNAME=""
EXPECTED_NODE_ID=""
EXPECTED_TAILSCALE_IP=""
SOURCE_REVISION=""
ROLLBACK_TAG=""
ROLLBACK_IMAGE_DIGEST=""
SERVICE_NAME=""
WEB_PORT=""
HEALTH_PATH=""
SMOKE_PATH=""
WAIT_SECONDS=""
COMPOSE_PROJECT_NAME=""
IMAGE_NAME=""
DEPLOY_LOCK_PATH=""

ROLLBACK_IMAGE_REFERENCE=""
REVISION_IMAGE_DIGEST=""
REVISION_IMAGE_REFERENCE=""

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

valid_digest() {
  [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]]
}

valid_path() {
  [[ "$1" == /* ]] && [[ "$1" != *'..'* ]] && [[ "$1" != *' '* ]]
}

validate_trusted_directory() {
  local directory="$1" label="$2" directory_owner directory_mode directory_type directory_bits
  [[ -d "$directory" ]] || die "$label directory does not exist: $directory"
  [[ ! -L "$directory" ]] || die "$label directory must not be a symlink"
  directory_owner="$(stat -c '%u' -- "$directory")"
  directory_mode="$(stat -c '%a' -- "$directory")"
  directory_type="$(stat -c '%F' -- "$directory")"
  [[ "$directory_type" == directory && "$directory_owner" == "$EUID" ]] || die "$label directory must be owned by the current user"
  directory_bits=$((8#$directory_mode))
  (( (directory_bits & 0022) == 0 )) || die "$label directory must not be group- or world-writable"
}

validate_lock_path() {
  local lock_dir lock_name lock_owner lock_mode lock_type lock_bits
  lock_dir="${DEPLOY_LOCK_PATH%/*}"
  lock_name="${DEPLOY_LOCK_PATH##*/}"
  [[ "$lock_name" =~ ^[A-Za-z0-9_.-]+$ ]] || die "invalid deployment lock filename"
  validate_trusted_directory "$lock_dir" "deployment lock"
  [[ ! -L "$DEPLOY_LOCK_PATH" ]] || die "deployment lock path must not be a symlink"
  if [[ -e "$DEPLOY_LOCK_PATH" ]]; then
    lock_owner="$(stat -c '%u' -- "$DEPLOY_LOCK_PATH")"
    lock_mode="$(stat -c '%a' -- "$DEPLOY_LOCK_PATH")"
    lock_type="$(stat -c '%F' -- "$DEPLOY_LOCK_PATH")"
    [[ ( "$lock_type" == "regular file" || "$lock_type" == "regular empty file" ) && "$lock_owner" == "$EUID" ]] || die "deployment lock file must be owned by the current user"
    lock_bits=$((8#$lock_mode))
    (( (lock_bits & 0077) == 0 )) || die "deployment lock file must be owner-readable only"
  fi
}

load_contract() {
  [[ -r "$CONFIG_PATH" ]] || die "deployment contract not readable: $CONFIG_PATH"

  local line key value mode mode_bits config_dir config_owner config_type
  local -A seen_keys=()

  config_dir="${CONFIG_PATH%/*}"
  [[ "$config_dir" == "$CONFIG_PATH" ]] && config_dir=.
  validate_trusted_directory "$config_dir" "deployment contract"
  [[ ! -L "$CONFIG_PATH" ]] || die "deployment contract must not be a symlink"
  exec 8<"$CONFIG_PATH" || die "could not open deployment contract"
  mode="$(stat -L -c '%a' -- "/proc/$$/fd/8")" || die "could not inspect deployment contract permissions"
  config_owner="$(stat -L -c '%u' -- "/proc/$$/fd/8")" || die "could not inspect deployment contract owner"
  config_type="$(stat -L -c '%F' -- "/proc/$$/fd/8")" || die "could not inspect deployment contract type"
  [[ "$config_owner" == "$EUID" && "$config_type" == "regular file" ]] || die "deployment contract must be a regular file owned by the current user"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || die "could not determine deployment contract permissions"
  mode_bits=$((8#$mode))
  (( (mode_bits & 0400) != 0 && (mode_bits & 0077) == 0 )) || die "deployment contract must have owner-read mode and no group/other mode access"

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
      TARGET_ENVIRONMENT|TARGET_DESIGNATION|TARGET_HOSTNAME|EXPECTED_NODE_ID|EXPECTED_TAILSCALE_IP|SOURCE_REVISION|ROLLBACK_TAG|ROLLBACK_IMAGE_DIGEST|SERVICE_NAME|WEB_PORT|HEALTH_PATH|SMOKE_PATH|WAIT_SECONDS|COMPOSE_PROJECT_NAME|IMAGE_NAME|DEPLOY_LOCK_PATH)
        [[ -z "${seen_keys[$key]+x}" ]] || die "duplicate contract key: $key"
        seen_keys["$key"]=1
        printf -v "$key" '%s' "$value"
        ;;
      *)
        die "unsupported contract key: $key"
        ;;
    esac
  done <&8
  exec 8<&-
}

require_contract_value() {
  local key="$1"
  [[ -n "${!key:-}" ]] || die "missing contract value: $key"
}

validate_contract() {
  local key
  for key in TARGET_ENVIRONMENT TARGET_DESIGNATION TARGET_HOSTNAME EXPECTED_NODE_ID EXPECTED_TAILSCALE_IP SOURCE_REVISION ROLLBACK_TAG ROLLBACK_IMAGE_DIGEST; do
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
  valid_digest "$ROLLBACK_IMAGE_DIGEST" || die "invalid ROLLBACK_IMAGE_DIGEST"
  valid_path "$HEALTH_PATH" || die "invalid HEALTH_PATH"
  valid_path "$SMOKE_PATH" || die "invalid SMOKE_PATH"
  [[ "$WAIT_SECONDS" =~ ^[0-9]+$ ]] && ((10#$WAIT_SECONDS >= 1 && 10#$WAIT_SECONDS <= 300)) || die "invalid WAIT_SECONDS"
  [[ "$SERVICE_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "invalid SERVICE_NAME"
  [[ "$COMPOSE_PROJECT_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "invalid COMPOSE_PROJECT_NAME"
  [[ "$IMAGE_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*(/[A-Za-z0-9][A-Za-z0-9_.-]*)?$ ]] || die "invalid IMAGE_NAME"
  [[ "$SOURCE_REVISION" =~ ^[0-9a-f]{40}$ ]] || die "SOURCE_REVISION must be a lowercase full commit ID"
  [[ "$DEPLOY_LOCK_PATH" == /* && "$DEPLOY_LOCK_PATH" != *'..'* && "$DEPLOY_LOCK_PATH" != *' '* ]] || die "invalid DEPLOY_LOCK_PATH"
  validate_lock_path
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
  [[ -z "$(git -C "$ROOT_DIR" status --porcelain)" ]] || die "checkout has uncommitted changes"
  CURRENT_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  EXPECTED_SHA="$(git -C "$ROOT_DIR" rev-parse "${SOURCE_REVISION}^{commit}" 2>/dev/null)" || die "SOURCE_REVISION is not a commit in this checkout"
  [[ "$CURRENT_SHA" == "$EXPECTED_SHA" ]] || die "checked-out revision does not match SOURCE_REVISION"
  REVISION_TAG="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
  valid_tag "$REVISION_TAG" || die "derived revision tag is invalid"
}

compose() {
  local image_reference="$1" image_tag="$2"
  shift 2
  ( \
    cd "$ROOT_DIR" && \
    IMAGE_TAG="$image_tag" \
    IMAGE_REFERENCE="$image_reference" \
    WEB_BIND_ADDRESS="$ACTUAL_TAILSCALE_IP" \
    WEB_PORT="$WEB_PORT" \
    IMAGE_NAME="$IMAGE_NAME" \
    COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
    docker compose -f "$COMPOSE_FILE" "$@" \
  )
}

verify_image() {
  local expected_reference="$1" expected_tag="$2" expected_image_id="$3"
  local container_id actual_image actual_image_id
  container_id="$(compose "$expected_reference" "$expected_tag" ps -q "$SERVICE_NAME" | head -n 1)"
  [[ -n "$container_id" ]] || return 1
  actual_image="$(docker inspect "$container_id" --format '{{.Config.Image}}')"
  [[ "$actual_image" == "$expected_reference" ]] || return 1
  actual_image_id="$(docker inspect "$container_id" --format '{{.Image}}')"
  [[ "$actual_image_id" == "$expected_image_id" ]]
}

wait_for_service() {
  local base_url="http://${ACTUAL_TAILSCALE_IP}:${WEB_PORT}" started_at=$SECONDS remaining timeout
  while :; do
    remaining=$((WAIT_SECONDS - (SECONDS - started_at)))
    ((remaining > 0)) || return 1
    timeout=$((remaining < 5 ? remaining : 5))
    if curl --fail --silent --show-error --max-time "$timeout" "$base_url$HEALTH_PATH" >/dev/null; then
      remaining=$((WAIT_SECONDS - (SECONDS - started_at)))
      if ((remaining > 0)); then
        timeout=$((remaining < 5 ? remaining : 5))
        if curl --fail --silent --show-error --max-time "$timeout" "$base_url$SMOKE_PATH" >/dev/null; then
          return 0
        fi
      fi
    fi
    remaining=$((WAIT_SECONDS - (SECONDS - started_at)))
    ((remaining > 0)) || return 1
    sleep 1
  done
}

acquire_deploy_lock() {
  local previous_umask
  validate_lock_path
  previous_umask="$(umask)"
  umask 077
  exec 9>>"$DEPLOY_LOCK_PATH"
  umask "$previous_umask"
  validate_lock_path
  flock -n 9 || die "another deployment is already active"
  LOCK_HELD=1
}

release_deploy_lock() {
  ((LOCK_HELD == 1)) || return 0
  flock -u 9 2>/dev/null || true
  exec 9>&-
  LOCK_HELD=0
}

verify_compose_image_name() {
  local rendered_image
  rendered_image="$(compose "$IMAGE_NAME:$REVISION_TAG" "$REVISION_TAG" config --format json | jq -r --arg service "$SERVICE_NAME" '.services[$service].image // empty')"
  [[ "$rendered_image" == "$IMAGE_NAME:$REVISION_TAG" ]] || die "Compose image does not match IMAGE_NAME and revision"
}

image_id() {
  local image_reference="$1" image_id
  image_id="$(docker image inspect "$image_reference" --format '{{.Id}}' 2>/dev/null)" || return 1
  valid_digest "$image_id" || return 1
  printf '%s\n' "$image_id"
}

verify_image_id() {
  local image_reference="$1" expected_id="$2" actual_id
  actual_id="$(image_id "$image_reference")" || return 1
  [[ "$actual_id" == "$expected_id" ]]
}

run_deployment() {
  acquire_deploy_lock

  if [[ "$MODE" == rollback ]]; then
    DEPLOY_STARTED=1
    rollback
    release_deploy_lock
    return 0
  fi

  log "building $IMAGE_NAME:$REVISION_TAG"
  compose "$IMAGE_NAME:$REVISION_TAG" "$REVISION_TAG" build --pull=false "$SERVICE_NAME"
  REVISION_IMAGE_DIGEST="$(image_id "$IMAGE_NAME:$REVISION_TAG")" || die "built image ID is unavailable"
  REVISION_IMAGE_REFERENCE="$IMAGE_NAME:$REVISION_TAG"
  DEPLOY_STARTED=1
  log "starting service $SERVICE_NAME"
  compose "$REVISION_IMAGE_REFERENCE" "$REVISION_TAG" up -d --no-build "$SERVICE_NAME"
  log "waiting for configured health and smoke checks"
  wait_for_service || die "post-deploy health or smoke check failed"
  verify_image "$REVISION_IMAGE_REFERENCE" "$REVISION_TAG" "$REVISION_IMAGE_DIGEST" || die "running image does not match the requested revision"
  log "deployment verified"
  release_deploy_lock
}

rollback() {
  ROLLING_BACK=1
  log "rolling back to $ROLLBACK_IMAGE_REFERENCE"
  if ! compose "$ROLLBACK_IMAGE_REFERENCE" "$ROLLBACK_TAG" up -d --no-build "$SERVICE_NAME"; then
    log "rollback command failed"
    return 1
  fi
  if ! wait_for_service || ! verify_image "$ROLLBACK_IMAGE_REFERENCE" "$ROLLBACK_TAG" "$ROLLBACK_IMAGE_DIGEST"; then
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
  release_deploy_lock
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
  require_command stat
  load_contract

  : "${SERVICE_NAME:=web}"
  : "${WEB_PORT:=8080}"
  : "${HEALTH_PATH:=/health}"
  : "${SMOKE_PATH:=/workspace}"
  : "${WAIT_SECONDS:=30}"
  : "${COMPOSE_PROJECT_NAME:=btcusd-chart}"
  : "${IMAGE_NAME:=btcusd-chart}"
  : "${DEPLOY_LOCK_PATH:=/run/btcusd-chart/btcusd-chart-deploy.lock}"

  require_command hostname
  require_command tailscale
  require_command jq
  require_command git
  require_command docker
  require_command curl
  require_command head
  require_command sleep
  require_command flock

  validate_contract
  discover_target
  discover_revision

  ROLLBACK_IMAGE_REFERENCE="$IMAGE_NAME:$ROLLBACK_TAG"
  verify_image_id "$IMAGE_NAME:$ROLLBACK_TAG" "$ROLLBACK_IMAGE_DIGEST" || die "rollback tag does not match ROLLBACK_IMAGE_DIGEST"
  compose "$IMAGE_NAME:$REVISION_TAG" "$REVISION_TAG" config >/dev/null || die "Compose configuration is invalid"
  verify_compose_image_name

  log "target=$TARGET_HOSTNAME address=$ACTUAL_TAILSCALE_IP port=$WEB_PORT revision=$REVISION_TAG rollback=$ROLLBACK_TAG"
  if ((DRY_RUN == 1)); then
    log "dry-run: would build $IMAGE_NAME:$REVISION_TAG and update service $SERVICE_NAME"
    log "dry-run: failed health or smoke verification would restore $IMAGE_NAME:$ROLLBACK_TAG"
    return 0
  fi

  if [[ "$MODE" == rollback ]]; then
    run_deployment
    return 0
  fi

  run_deployment
}

trap on_exit EXIT
main "$@"
