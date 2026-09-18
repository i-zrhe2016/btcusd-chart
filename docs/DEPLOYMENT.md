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
`deploy/tailscale.env.example` and keep the completed file owner-readable, for
example at `/etc/btcusd-chart/tailscale.env`.

Required values include:

- `TARGET_HOSTNAME`, `EXPECTED_NODE_ID`, and `EXPECTED_TAILSCALE_IP` for the
  target identity. The entrypoint discovers the local Tailscale IPv4 and checks
  it against the contract; it never uses a caller-supplied address as the
  destination.
- `TARGET_DESIGNATION=tailscale-hardened` and the target environment.
- `SOURCE_REVISION` for the checked-out immutable Git revision.
- `ROLLBACK_TAG` for an already available known-good image.
- `WEB_PORT`, health/smoke paths, and the Compose project/service names.

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

The command builds an image tagged with the checked-out revision, updates only
the configured Compose service, checks `/health` and the configured smoke path,
and retains the previous image. A failed post-deploy check attempts one
rollback and verifies the rollback health before returning failure.

Run the documented rollback explicitly when required:

```bash
bash deploy/tailscale-compose-deploy.sh \
  --config /etc/btcusd-chart/tailscale.env \
  --rollback
```

The entrypoint is an existing operator command, not a replacement for target
hardening or an access catalog. It must be run on the approved target through
the approved management path.

The local rollback path is to stop the Compose project and rebuild from the
last known-good Git revision:

```bash
docker compose down
git switch --detach <known-good-revision>
IMAGE_TAG="<known-good-revision>" docker compose up -d --build
```
