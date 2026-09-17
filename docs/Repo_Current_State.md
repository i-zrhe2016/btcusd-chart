# Repository Current State

Last verified: 2026-09-17 @ 99a9246

## Current Focus

- Unified web chart foundation is delivered; the next implementation is Binance history and realtime data in [Issue #8](https://github.com/i-zrhe2016/btcusd-chart/issues/8).

## Implemented

- A Vite + React + TypeScript browser app serves the root route with a responsive market-terminal workspace.
- Lightweight Charts 5.2 renders deterministic candlesticks and volume for `BTCUSD`, `ETHUSD`, `SOLUSD`, and `BNBUSD` across the supported intervals.
- Typed Zustand state drives symbol and interval selection, with watchlist filtering, symbol switching, keyboard-accessible controls, and a mobile market selector.
- Chart resources are resized and disposed through the component lifecycle; fixture data is deterministic and explicitly presented as preview data.
- `npm test`, `npm run typecheck`, and `npm run build` pass on the verified base commit.

## Known Issues / Failing Checks

- None known in the delivered foundation. Live exchange connectivity is intentionally not implemented yet.

## Constraints

- Delivery is browser-only; Electron, native windows, IPC, and desktop packaging are out of scope.
- Market data is local fixture data until Issue #8 is delivered; the UI must not present it as live exchange data.
- Supported runtime versions are Node `^20.19.0 || >=22.12.0`.

## Architecture Snapshot

- A single Vite/React renderer composes the workspace shell, watchlist, controls, and chart surface.
- Zustand owns the selected symbol/interval; `PriceChart` owns one Lightweight Charts instance and its resize/unmount lifecycle.
- Fixture generation is isolated under `src/data/`; shared market contracts are under `src/types/`.

## Next

- [Issue #8](https://github.com/i-zrhe2016/btcusd-chart/issues/8): connect Binance REST history and WebSocket realtime market data through a browser-side shared hub.
