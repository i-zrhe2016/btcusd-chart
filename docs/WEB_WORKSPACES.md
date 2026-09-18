# Browser Workspaces

The chart workspace supports independent browser windows. Use **New window**
in the chart toolbar to open the active symbol and interval in a separate
browser window.

Each window initializes its chart from the URL parameters:

```text
/?symbol=ETHUSD&interval=1h
```

The active symbol and interval are kept in the current window URL, so a
reload preserves the latest selection.

The parent and child windows have independent browser state. Changing the
symbol or interval in one window does not change the other window. They may
still use the same public Binance market data source, but this MVP does not
coordinate cross-window state, link groups, layouts, or persistence.

The action must be initiated by a user click so the browser can allow the
popup. Browser popup permissions remain browser-controlled; after allowing
popups for the chart origin, click **New window** again if needed.
