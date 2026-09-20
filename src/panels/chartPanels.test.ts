import { describe, expect, it } from "vitest";
import { createDefaultPanels, DEFAULT_PANEL_INTERVALS, setPanelInterval } from "./chartPanels";

describe("chart panels", () => {
  it("builds one panel per default timeframe in reading order", () => {
    const panels = createDefaultPanels();

    expect(panels.map((panel) => panel.interval)).toEqual([...DEFAULT_PANEL_INTERVALS]);
    expect(panels.map((panel) => panel.symbol)).toEqual(["BTCUSD", "BTCUSD", "BTCUSD", "BTCUSD"]);
    expect(new Set(panels.map((panel) => panel.id)).size).toBe(4);
  });

  it("changes only the targeted panel timeframe", () => {
    const panels = createDefaultPanels();
    const next = setPanelInterval(panels, "panel-2", "1m");

    expect(next.map((panel) => panel.interval)).toEqual(["15m", "1m", "4h", "1d"]);
    expect(next.map((panel) => panel.id)).toEqual(panels.map((panel) => panel.id));
    expect(panels.map((panel) => panel.interval)).toEqual([...DEFAULT_PANEL_INTERVALS]);
  });

  it("ignores an unknown panel id", () => {
    const panels = createDefaultPanels();

    expect(setPanelInterval(panels, "panel-missing", "1m")).toEqual(panels);
  });
});
