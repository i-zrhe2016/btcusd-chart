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
For a shared or production environment, define a separate deployment contract
covering the target identity, public access boundary, TLS, secrets, health and
smoke checks, immutable artifact retention, and rollback before changing the
default localhost-only binding.

The local rollback path is to stop the Compose project and rebuild from the
last known-good Git revision:

```bash
docker compose down
git switch --detach <known-good-revision>
IMAGE_TAG="<known-good-revision>" docker compose up -d --build
```
