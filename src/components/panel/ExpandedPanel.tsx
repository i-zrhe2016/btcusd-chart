import { useEffect, useRef } from "react";
import PriceChart from "../chart/PriceChart";
import { useMarketData } from "../../market-data/useMarketData";
import type { Interval, Symbol } from "../../types/market";
import { statusLabel, statusMessage } from "./panelStatus";

export interface ExpandedPanelProps {
  panelId: string;
  symbol: Symbol;
  interval: Interval;
  onClose: () => void;
}

/**
 * A reading view for one panel. It subscribes to the same market key as its
 * panel, so the hub shares the existing subscription instead of opening a second
 * one, and it renders the same symbol and timeframe the panel showed.
 */
export default function ExpandedPanel({ panelId, symbol, interval, onClose }: ExpandedPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const market = useMarketData({ symbol, interval });
  const title = `${symbol} ${interval}`;
  const hasCandles = market.candles.length > 0;
  const label = statusLabel(market.status);
  const message = statusMessage(market.status, market.error);
  // This view is the active reading surface and owns its subscription, so it
  // recovers the same way a panel does: cover the chart only while there is
  // nothing to read, and otherwise keep the candles with a retry strip.
  const showBlockingMessage = !hasCandles;
  const showErrorBanner = hasCandles && market.status === "error";

  useEffect(() => {
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      // The overlay declares itself modal, so Tab must not reach the grid behind
      // it. The dialog holds a single focusable control, so wrapping is enough.
      const dialog = dialogRef.current;

      if (!dialog) {
        return;
      }

      const focusable = [...dialog.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex=\"-1\"])")]
        .filter((element) => !element.hasAttribute("disabled"));

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!dialog.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }

      // The dialog itself starts focused and is inside the trap, so it needs its
      // own wrap: forward Tab enters the controls, reverse Tab enters at the end.
      if (active === dialog) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div
        className="panel-overlay-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${title} expanded chart`}
        ref={dialogRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panel-overlay-header">
          <span className="panel-symbol">{title}</span>
          <span className="panel-overlay-status">{label}</span>
          <button className="panel-overlay-close" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="panel-overlay-body">
          <PriceChart
            candles={market.candles}
            symbol={symbol}
            viewKey={`${panelId}:${symbol}:${interval}:expanded`}
            onExpand={onClose}
          />
          {showBlockingMessage && (
            <div
              className={`panel-message status-${market.status}`}
              role={market.status === "error" ? "alert" : "status"}
              aria-live="polite"
            >
              <strong>{label}</strong>
              <span>{message}</span>
              {market.status === "error" && (
                <button className="retry-button" type="button" onClick={market.retry}>
                  Retry
                </button>
              )}
            </div>
          )}
          {showErrorBanner && (
            <div className="panel-banner status-error" role="alert" aria-live="polite">
              <span>{message}</span>
              <button className="retry-button" type="button" onClick={market.retry}>
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
