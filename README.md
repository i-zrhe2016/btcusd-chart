# BTCUSD Chart

Browser-only TradingView-like BTCUSD charting workspace.

The MVP uses Vite, React, TypeScript, Lightweight Charts 5.2, Zustand, and
Binance public spot market data. A browser-side MarketDataHub shares history and
WebSocket subscriptions for identical markets within one tab. The chart keeps
loading, disconnected, stale, and error states visible and does not fall back to
local fixture data after live mode is enabled.

The current market mapping includes `BTCUSD -> BTCUSDT`, `ETHUSD -> ETHUSDT`,
`SOLUSD -> SOLUSDT`, and `BNBUSD -> BNBUSDT`. Public history uses Binance's
market-data REST endpoint and realtime candles use the public kline stream.

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
