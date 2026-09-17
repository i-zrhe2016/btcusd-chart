# BTCUSD Chart

Browser-only TradingView-like BTCUSD charting workspace.

The MVP uses Vite, React, TypeScript, Lightweight Charts 5.2, Zustand, and
Binance public market data. A browser-side MarketDataHub will share history and
WebSocket subscriptions across chart panels; workspace configuration and a
bounded candle cache will use browser storage.
