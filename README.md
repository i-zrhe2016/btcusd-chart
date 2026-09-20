# BTCUSD Chart

Browser-only BTCUSD K-line terminal: four chart panels in a 2x2 grid at 15m /
1h / 4h / 1D on a pure-black workspace.

The terminal uses Vite, React, TypeScript, Lightweight Charts 5.2, and Binance
public spot market data. A browser-side MarketDataHub shares history and
WebSocket subscriptions for identical markets within one tab, so the four panels
hold four independent subscriptions. Each panel keeps loading, stale,
disconnected, and error states visible and does not fall back to local fixture
data after live mode is enabled.

The chart surface is black and white only: rising candles are hollow with a
white border and wick, falling candles are filled white, and there are no grid
lines. Double-click a panel to read its chart enlarged; click outside it or
press Escape to close.

`BTCUSD` is the terminal's only market and it maps to `BTCUSDT`. Public history
uses Binance's market-data REST endpoint and realtime candles use the public
kline stream. See [docs/Repo_Current_State.md](docs/Repo_Current_State.md) for
the verified current state of the repository.

## Development

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

The development server binds to `127.0.0.1` by default. Set `VITE_DEV_HOST`
when the browser needs to reach the server from another host or container.

## Deployment

Docker Compose support is documented in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
The default Compose target builds the app and serves it through Nginx at
`http://127.0.0.1:8080/` with a container health check at `/health`.
