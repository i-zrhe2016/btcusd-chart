import type { MarketDataErrorInfo, MarketDataStatus } from "../../market-data/types";
import { statusLabel, statusMessage } from "./panelStatus";

export interface PanelStatusOverlayProps {
  status: MarketDataStatus;
  error: MarketDataErrorInfo | null;
  hasCandles: boolean;
  onRetry: () => void;
}

/**
 * The status treatment shared by a panel and its expanded reading view. It keeps
 * the two surfaces from diverging: while there is nothing to read the chart is
 * covered, and once candles exist an error becomes a strip that leaves them
 * visible.
 */
export default function PanelStatusOverlay({
  status,
  error,
  hasCandles,
  onRetry,
}: PanelStatusOverlayProps) {
  const label = statusLabel(status);
  const message = statusMessage(status, error);

  if (!hasCandles) {
    return (
      <div
        className={`panel-message status-${status}`}
        role={status === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        <strong>{label}</strong>
        <span>{message}</span>
        {status === "error" && (
          <button className="retry-button" type="button" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }

  if (status !== "error") {
    return null;
  }

  return (
    <div className="panel-banner status-error" role="alert" aria-live="polite">
      <span>{message}</span>
      <button className="retry-button" type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
