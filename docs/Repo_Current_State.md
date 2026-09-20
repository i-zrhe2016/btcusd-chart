# Repository Current State

Last verified: 2026-09-20 @ ee8247f

## Current Focus

- Browser-only Binance charting workspace with independent browser windows is merged on `main`.
- The guarded Tailscale deployment entrypoint merged in PR #32; promoting a revision to the Tailscale runtime is still an external release handoff.
- The next product direction remains responsive chart layouts and link groups in [Issue #9](https://github.com/i-zrhe2016/btcusd-chart/issues/9).

## Implemented

- A Vite + React + TypeScript browser app serves the root route with a responsive market-terminal workspace.
- Lightweight Charts 5.2 renders Binance-backed candlesticks and volume for `BTCUSD`, `ETHUSD`, `SOLUSD`, and `BNBUSD` across the supported intervals.
- Typed Zustand state drives symbol and interval selection, with watchlist filtering, symbol switching, keyboard-accessible controls, and a mobile market selector.
- `BinanceRestClient` loads public historical klines through the Binance market-data REST endpoint, while the public kline WebSocket supplies open-candle and closed-candle updates.
- `MarketDataHub` shares identical market-key subscriptions within one browser tab, reference-counts listeners, buffers the REST/WebSocket handoff, reconnects with bounded backoff, and exposes stale/disconnected/error states.
- Chart resources are resized and disposed through the component lifecycle; live candle tails use incremental series updates and fixture generation remains isolated to tests.
- The chart toolbar opens the active symbol and interval in an independent browser window using `noopener,noreferrer`. The popup URL contains only the application pathname plus validated chart state.
- Chart state hydrates from `symbol` and `interval` URL parameters. User selections use browser history, `popstate` rehydrates state, and parent and child windows keep independent Zustand stores.
- Cross-window synchronization, link groups, workspace persistence, Electron, native window management, and multi-monitor orchestration are not implemented.
- A multi-stage `Dockerfile` builds the Vite bundle with Node and serves the static output from Nginx; `docker-compose.yml` provides a localhost-only web service with a `/health` endpoint, SPA fallback, and container health check. See [docs/DEPLOYMENT.md](DEPLOYMENT.md).
- `deploy/tailscale-compose-deploy.sh` deploys the checked-out revision to the Tailscale-bound Compose service. It validates the external contract and the local Tailscale identity, takes its directory lock before target and revision discovery and holds it across build, update, verification, and rollback, refuses a dirty or wrong-revision checkout both before and after the build, and requires every Git-ignored path to be excluded from the Docker build context by a `.dockerignore` rule using Docker's separator depth, `**`, and last-match-wins negation.
- The entrypoint starts the captured local image ID instead of a mutable tag and asserts the running container against it for the revision and the rollback, verifies the configured health and smoke paths including their response markers, and performs exactly one verified rollback to `ROLLBACK_TAG`/`ROLLBACK_IMAGE_DIGEST` when post-deploy verification fails. `--dry-run` and `--rollback` are supported.
- `deploy/tailscale-compose-deploy.test.sh` exercises the entrypoint against Docker fakes without a daemon; `deploy/tailscale-compose-deploy.integration.sh` is an opt-in real-Docker lane (`DEPLOY_INTEGRATION=1`) that builds, deploys, verifies, and rolls back with per-run project, image, and port resources.
- `docker-compose.yml` renders the service image from `IMAGE_REFERENCE`, defaulting to the localhost-only tag.

## Validation

- `npm test -- --run`: 31 tests passed (2026-09-20).
- `npm run typecheck` and `npm run build`: passed (2026-09-20).
- `bash deploy/tailscale-compose-deploy.test.sh`: passed (2026-09-20).
- `DEPLOY_INTEGRATION=1 bash deploy/tailscale-compose-deploy.integration.sh`: passed on the delivered revision, including the failed-deploy rollback path (2026-09-20).
- `git diff --check`: passed for delivered changes.
- `docker compose config`: passed with the default localhost-only binding.
- Real Chromium verification passed against the development server: a child window opened, inherited the active chart state, changed interval independently, retained `window.opener === null`, and left the parent chart unchanged.

## Deployment

- Default Compose remains explicitly non-publishing and binds to `127.0.0.1:8080`.
- The existing Tailscale deployment is reachable on node `aws` at port `8081` (the node address is intentionally omitted from published state documentation).
- Read-only runtime verification on 2026-09-20 returned HTTP 200 from `/health` and `/workspace`.
- The image that runtime serves is Unverified: the last recorded check on 2026-09-18 found `btcusd-chart:acd65a0` (digest `sha256:36e0e368f06bd2a12f6360887f50c68d283d7beea6005d045a4f7c54431046b3`), and this host has no SSH access to re-check it.
- The repository provides the entrypoint and its documented contract, but no target contract file is recorded here. Promoting a revision to the runtime is an external release handoff performed by the target's release owner.

## Known Issues / Failing Checks

- No known source or focused-validation failures in the delivered integration.
- The Tailscale runtime still lags `main`; the delivered entrypoint has not been executed against it.
- Public market data still depends on Binance availability and the browser network path.

## Constraints

- Delivery is browser-only; Electron, native windows, IPC, and desktop packaging are out of scope.
- The Compose deployment is explicitly non-publishing by default and binds to `127.0.0.1:8080`; remote deployment, public ingress, DNS, TLS, and credentials are not configured in the repository.
- The deployment entrypoint requires Docker Compose v2 plus `tailscale`, `jq`, `git`, `curl`, `hostname`, `sleep`, `flock`, and `stat` on the target, and it treats the target checkout as exclusive for the duration of a run.
- The Tailscale address and port above are runtime operator configuration and are not the default Compose binding.
- The initial source is Binance public spot data: `BTCUSD -> BTCUSDT`, `ETHUSD -> ETHUSDT`, `SOLUSD -> SOLUSDT`, and `BNBUSD -> BNBUSDT`.
- History and realtime subscriptions are shared only within the current browser tab; authentication, private APIs, backend proxying, cross-tab sharing, and other exchanges are out of scope for the current MVP.
- Supported runtime versions are Node `^20.19.0 || >=22.12.0`.

## Architecture Snapshot

- A single Vite/React renderer composes the workspace shell, watchlist, controls, and chart surface.
- Zustand owns the selected symbol/interval; `PriceChart` owns one Lightweight Charts instance and its resize/unmount lifecycle.
- `src/windowing/chartWindow.ts` owns chart URL validation, safe popup URL construction, and browser window opening; `src/stores/chartStore.ts` hydrates the initial chart state.
- `src/market-data/` contains typed Binance payload parsing, REST history, WebSocket streams, the browser-side `MarketDataHub`, and the React subscription hook.
- The container build produces static assets only; Nginx serves them with an SPA fallback and a read-only health endpoint.
- Fixture generation is isolated under `src/data/`; shared market contracts are under `src/types/`.

## Next

- [Issue #9](https://github.com/i-zrhe2016/btcusd-chart/issues/9): add responsive chart layouts and link groups.
