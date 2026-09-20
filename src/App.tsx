import { useEffect, useRef, useState } from "react";
import ChartPanel from "./components/panel/ChartPanel";
import ExpandedPanel from "./components/panel/ExpandedPanel";
import { createDefaultPanels, setPanelInterval, type ChartPanelConfig } from "./panels/chartPanels";
import type { Interval } from "./types/market";

const PAGE_TITLE = "BTCUSD Chart";

export default function App() {
  const [panels, setPanels] = useState<ChartPanelConfig[]>(createDefaultPanels);
  const [expandedPanelId, setExpandedPanelId] = useState<string | null>(null);
  const panelRefs = useRef(new Map<string, HTMLElement>());
  const expandedPanel = panels.find((panel) => panel.id === expandedPanelId) ?? null;

  useEffect(() => {
    document.title = PAGE_TITLE;
  }, []);

  const changeInterval = (panelId: string, interval: Interval) => {
    setPanels((current) => setPanelInterval(current, panelId, interval));
  };

  const closeExpandedPanel = () => {
    const panelId = expandedPanelId;

    setExpandedPanelId(null);

    if (panelId) {
      panelRefs.current.get(panelId)?.focus();
    }
  };

  return (
    <div className="terminal">
      <main className="terminal-grid" aria-label="Four-chart terminal">
        {panels.map((panel) => (
          <ChartPanel
            key={panel.id}
            panelId={panel.id}
            symbol={panel.symbol}
            interval={panel.interval}
            onIntervalChange={(interval) => changeInterval(panel.id, interval)}
            onExpand={() => setExpandedPanelId(panel.id)}
            ref={(node) => {
              if (node) {
                panelRefs.current.set(panel.id, node);
              } else {
                panelRefs.current.delete(panel.id);
              }
            }}
          />
        ))}
      </main>
      {expandedPanel && (
        <ExpandedPanel
          panelId={expandedPanel.id}
          symbol={expandedPanel.symbol}
          interval={expandedPanel.interval}
          onClose={closeExpandedPanel}
        />
      )}
    </div>
  );
}
