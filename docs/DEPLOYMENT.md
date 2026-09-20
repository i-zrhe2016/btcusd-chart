# Deployment

The repository includes a Docker Compose deployment for the browser-only web
application. It builds the Vite bundle in a Node stage and serves the static
output from Nginx.

## Local Compose target

This target is explicitly non-publishing by default. Docker Compose binds the
container to `127.0.0.1:8080`, so it is intended for local verification or a
host with an independently defined access boundary. It does not configure a
public listener, domain, TLS, exchange credentials, or a remote server.

Prerequisites:

- Docker Engine
- Docker Compose v2

Validate and start the service:

```bash
docker compose config
docker compose up -d --build
```

The application is available at <http://127.0.0.1:8080/>. Verify the service
and its container health before using it:

```bash
curl --fail http://127.0.0.1:8080/health
docker compose ps
```

`/health` returns `ok`, and unknown paths fall back to the SPA entry point so
browser history navigation remains available.

Stop the local deployment with:

```bash
docker compose down
```

## Traceable image builds

For a build tied to a known Git revision, use that revision as the local image
tag rather than `latest`:

```bash
IMAGE_TAG="$(git rev-parse --short HEAD)" docker compose build
IMAGE_TAG="$(git rev-parse --short HEAD)" docker compose up -d
```

The Compose file still defaults to the `local` tag for convenient development.
For the existing Tailscale-bound shared service, use the guarded entrypoint at
`deploy/tailscale-compose-deploy.sh`. It does not change firewall, SSH, DNS,
TLS, or unrelated host services. The target must already have its Tailscale
access boundary and recovery path reviewed before this command is allowed to
change the container.

## Tailscale deployment contract

The contract is external runtime configuration and must not be committed with
real host values or credentials. Start from
`deploy/tailscale.env.example` and keep the completed file owner-readable only
in its POSIX mode bits (`chmod 600` or stricter), for example at
`/etc/btcusd-chart/tailscale.env`. Verify any extended ACLs separately; the
entrypoint does not claim to inspect filesystem ACL entries.

The command must run on the approved target checkout with Docker Compose v2,
`tailscale`, `jq`, `git`, `curl`, `hostname`, `sleep`, `flock`, and `stat`
available. The operating-system hostname and the Tailscale hostname must
both match `TARGET_HOSTNAME`. The checkout must be clean and its `HEAD` must
match `SOURCE_REVISION`. Ignored files are tolerated only when `.dockerignore`
already keeps them out of the Docker build context, such as `node_modules/`,
`dist/`, `coverage/`, `.playwright-cli/`, build metadata, and local `.env`
files; any other ignored path stops the run before the first mutation.
`DEPLOY_LOCK_PATH` names a trusted directory used for directory-level `flock`;
it must be owned by the current user and must not be group/world-writable.
Create the default directory before first use with
`install -d -m 755 /run/btcusd-chart`.

The entrypoint runs as the owner of the contract directory and of
`DEPLOY_LOCK_PATH`, and it refuses a contract or lock directory owned by another
user. The documented `/etc/btcusd-chart` and `/run/btcusd-chart` locations are
root-owned when they are created by root, so run the entrypoint as root through
the approved management path, or point both settings at directories owned by
the deployment account.

Required values:

- `TARGET_HOSTNAME`, `EXPECTED_NODE_ID`, and `EXPECTED_TAILSCALE_IP` for the
  target identity. The entrypoint discovers the local Tailscale IPv4 and checks
  it against the contract; it never uses a caller-supplied address as the
  destination.
- `TARGET_ENVIRONMENT` and `TARGET_DESIGNATION=tailscale-hardened`.
- `SOURCE_REVISION` for the checked-out immutable 40-character Git commit ID.
- `ROLLBACK_TAG` and `ROLLBACK_IMAGE_DIGEST` for an already available
  known-good local image. `ROLLBACK_IMAGE_DIGEST` is the local content-addressed
  image ID returned by `.Id`, and it must match the local tag. Obtain it on the
  target with `docker image inspect <image>:<tag> --format '{{.Id}}'`.

Optional settings use the defaults shown in `deploy/tailscale.env.example` when
they are omitted:

- `SERVICE_NAME`, `WEB_PORT`, `COMPOSE_PROJECT_NAME`, and `IMAGE_NAME`.
- `HEALTH_PATH` and `SMOKE_PATH` with `HEALTH_MARKER` and `SMOKE_MARKER`, which
  name the response content that must appear on those paths so a healthy
  listener that is not this application cannot pass verification. The defaults
  are `/health`, `/workspace`, `ok`, and `BTCUSD Chart`. Each marker must be a
  plain single-line literal of at most 128 characters without glob
  metacharacters.
- `WAIT_SECONDS` for the combined health and smoke wait budget and
  `DEPLOY_LOCK_PATH` for the lock directory.

Before the first mutation, verify the target boundary and recovery path through
the applicable operator controls. The entrypoint deliberately refuses a
missing or mismatched contract, an unavailable rollback image, an invalid
Compose configuration, or a non-matching checkout.

Validate without changing the service:

```bash
bash deploy/tailscale-compose-deploy.sh \
  --config /etc/btcusd-chart/tailscale.env \
  --dry-run
```

Deploy the checked-out contract revision:

```bash
bash deploy/tailscale-compose-deploy.sh \
  --config /etc/btcusd-chart/tailscale.env
```

The command builds an image tagged with the checked-out revision, captures its
local content-addressed image ID, starts the controlled revision tag, and
checks that the running container still has that captured image ID. It updates
only the configured Compose service, rejects scaled services with anything
other than one container, checks the configured health path (default
`/health`) and smoke path including their configured markers, and retains the
tagged images. A failed post-deploy
check attempts one rollback to the separately maintained
`ROLLBACK_TAG`/`ROLLBACK_IMAGE_DIGEST` pair and verifies that rollback before
returning failure. It does not infer or retag whatever image happened to be
running before the update. The entrypoint acquires its local directory lock
before it validates the target identity and the checked-out revision, and holds
it across build, update, verification, and rollback, so two concurrent
entrypoint invocations cannot interleave their validation and mutation. The
lock serializes this entrypoint only; keep the target checkout free of
concurrent writers because the build context is read after validation.

Run the documented rollback explicitly when required. Rollback still requires
the external contract, the approved target identity, the required command-line
tools, a clean checkout whose `HEAD` matches `SOURCE_REVISION`, a valid Compose
configuration, and the matching `ROLLBACK_TAG` plus
`ROLLBACK_IMAGE_DIGEST`; it is not a command that can be run safely from an
arbitrary checkout:

```bash
bash deploy/tailscale-compose-deploy.sh \
  --config /etc/btcusd-chart/tailscale.env \
  --rollback
```

The entrypoint is an existing operator command, not a replacement for target
hardening or an access catalog. It must be run on the approved target through
the approved management path.

## Verifying the entrypoint

Two checks cover the entrypoint and run from a clean checkout.

The fast unit suite uses fakes for the target identity, Docker, and HTTP, so it
needs no Docker daemon and is safe in CI:

```bash
bash deploy/tailscale-compose-deploy.test.sh
```

The opt-in integration check exercises the real Docker Compose lifecycle on the
local host: it builds a distinct known-good image, deploys the checked-out
revision, verifies the health and smoke responses, performs a verified
rollback, and confirms that a revision whose smoke marker only the known-good
image serves fails and is rolled back to that verified image. It uses a
disposable Compose project, image names, and port that are unique to the run,
and it removes them afterwards. It needs a running Docker daemon, a clean
checkout, and explicit opt-in:

```bash
DEPLOY_INTEGRATION=1 bash deploy/tailscale-compose-deploy.integration.sh
```

Set `DEPLOY_INTEGRATION_PORT` to pin the host port; otherwise the script picks a
free one.

The local rollback path is to stop the Compose project and rebuild from the
last known-good Git revision:

```bash
docker compose down
git switch --detach <known-good-revision>
IMAGE_TAG="<known-good-revision>" docker compose up -d --build
```
