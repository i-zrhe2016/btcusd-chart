import { useEffect, useRef } from "react";
import PriceChart from "../chart/PriceChart";
import { useMarketData } from "../../market-data/useMarketData";
import type { Interval, Symbol } from "../../types/market";
import { statusLabel } from "./panelStatus";

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

  useEffect(() => {
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
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
          <span className="panel-overlay-status">{statusLabel(market.status)}</span>
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
        </div>
      </div>
    </div>
  );
}
