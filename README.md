# BTCUSD Chart

Browser-only TradingView-like BTCUSD charting workspace.

The MVP uses Vite, React, TypeScript, Lightweight Charts 5.2, Zustand, and
Binance public market data. A browser-side MarketDataHub will share history and
WebSocket subscriptions across chart panels; workspace configuration and a
bounded candle cache will use browser storage.

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
