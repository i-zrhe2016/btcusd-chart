# Repository Current State

Last verified: 2026-09-17 @ 5b0263b

## Current Focus

- Browser-only Binance market data and localhost Docker Compose delivery are verified; the next implementation is responsive chart layouts and link groups in [Issue #9](https://github.com/i-zrhe2016/btcusd-chart/issues/9).

## Implemented

- A Vite + React + TypeScript browser app serves the root route with a responsive market-terminal workspace.
- Lightweight Charts 5.2 renders Binance-backed candlesticks and volume for `BTCUSD`, `ETHUSD`, `SOLUSD`, and `BNBUSD` across the supported intervals.
- Typed Zustand state drives symbol and interval selection, with watchlist filtering, symbol switching, keyboard-accessible controls, and a mobile market selector.
- `BinanceRestClient` loads public historical klines through the Binance market-data REST endpoint, while the public kline WebSocket supplies open-candle and closed-candle updates.
- `MarketDataHub` shares identical market-key subscriptions within one browser tab, reference-counts listeners, buffers the REST/WebSocket handoff, reconnects with bounded backoff, and exposes stale/disconnected/error states.
- Chart resources are resized and disposed through the component lifecycle; live candle tails use incremental series updates and fixture generation remains isolated to tests.
- A multi-stage `Dockerfile` builds the Vite bundle with Node and serves it from Nginx; `docker-compose.yml` provides a localhost-only web service with a `/health` endpoint, SPA fallback, and container health check. See [docs/DEPLOYMENT.md](DEPLOYMENT.md).
- `npm test` (21 tests), `npm run typecheck`, `npm run build`, `npm audit --omit=dev`, `docker compose config`, `docker compose build --pull`, container health, HTTP smoke checks, and the production-browser smoke flow pass on the delivered integration.

## Known Issues / Failing Checks

- None known in the delivered integration. Public market data still depends on Binance availability and the browser network path.

## Constraints

- Delivery is browser-only; Electron, native windows, IPC, and desktop packaging are out of scope.
- The Compose deployment is explicitly non-publishing by default and binds to `127.0.0.1:8080`; remote production deployment, public ingress, DNS, TLS, and credentials are not configured or verified.
- The initial source is Binance public spot data: `BTCUSD -> BTCUSDT`, `ETHUSD -> ETHUSDT`, `SOLUSD -> SOLUSDT`, and `BNBUSD -> BNBUSDT`.
- History and realtime subscriptions are shared only within the current browser tab; authentication, private APIs, backend proxying, cross-tab sharing, and other exchanges are out of scope for the current MVP.
- Supported runtime versions are Node `^20.19.0 || >=22.12.0`.

## Architecture Snapshot

- A single Vite/React renderer composes the workspace shell, watchlist, controls, and chart surface.
- Zustand owns the selected symbol/interval; `PriceChart` owns one Lightweight Charts instance and its resize/unmount lifecycle.
- `src/market-data/` contains typed Binance payload parsing, REST history, WebSocket streams, the browser-side `MarketDataHub`, and the React subscription hook.
- The container build produces static assets only; Nginx serves them with an SPA fallback and a read-only health endpoint.
- Fixture generation is isolated under `src/data/`; shared market contracts are under `src/types/`.

## Next

- [Issue #9](https://github.com/i-zrhe2016/btcusd-chart/issues/9): add responsive chart layouts and link groups.
