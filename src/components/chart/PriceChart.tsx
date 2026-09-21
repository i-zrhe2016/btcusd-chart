import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "../../types/market";

interface PriceChartProps {
  candles: Candle[];
  symbol: string;
  viewKey: string;
  onExpand?: () => void;
}

type CandlePoint = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

type ChartViewport = {
  timeScale: () => { fitContent: () => void };
};

type CandleSeries = {
  setData: (data: CandlePoint[]) => void;
  update: (data: CandlePoint) => void;
};

/**
 * The terminal is black and white only. A rising candle is drawn as a hollow
 * body, which Lightweight Charts renders when the body color matches the
 * surface and the border carries the ink; a falling candle is a filled body.
 */
const chartColors = {
  background: "#000000",
  text: "#b4b4b4",
  border: "#2a2a2a",
  crosshair: "#8a8a8a",
  up: "#ffffff",
  down: "#ffffff",
};

function toUtcTimestamp(time: number, previousTime: number): UTCTimestamp {
  if (!Number.isFinite(time) || !Number.isInteger(time) || time <= 0 || time > 10_000_000_000) {
    throw new Error("Candle timestamps must be Unix seconds");
  }

  const timestamp = time as UTCTimestamp;

  if (timestamp <= previousTime) {
    throw new Error("Candle timestamps must be strictly ascending");
  }

  return timestamp;
}

function toChartData(candles: Candle[]): CandlePoint[] {
  let previousTime = 0;

  return candles.map((candle) => {
    const time = toUtcTimestamp(candle.time, previousTime);
    previousTime = time;

    return {
      time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    };
  });
}

function pointsMatch(left: CandlePoint, right: CandlePoint) {
  return left.time === right.time
    && left.open === right.open
    && left.high === right.high
    && left.low === right.low
    && left.close === right.close;
}

function supportsIncrementalUpdate(previous: CandlePoint[], next: CandlePoint[]) {
  if (previous.length === 0 || next.length === 0 || next.length < previous.length || next.length > previous.length + 1) {
    return false;
  }

  const unchangedPrefixLength = Math.max(0, previous.length - 1);

  for (let index = 0; index < unchangedPrefixLength; index += 1) {
    if (!pointsMatch(previous[index], next[index])) {
      return false;
    }
  }

  if (next.length === previous.length) {
    return previous[previous.length - 1].time === next[next.length - 1].time;
  }

  return next[next.length - 1].time > previous[previous.length - 1].time;
}

export default function PriceChart({ candles, symbol, viewKey, onExpand }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartViewport | null>(null);
  const candleSeriesRef = useRef<CandleSeries | null>(null);
  const lastFitKeyRef = useRef<string | null>(null);
  const previousDataRef = useRef<{ viewKey: string; candleData: CandlePoint[] } | null>(null);
  const onExpandRef = useRef(onExpand);
  const latestCandle = candles[candles.length - 1];
  const dataSignature = candles
    .map((candle) => [candle.time, candle.open, candle.high, candle.low, candle.close].join(":"))
    .join("|");

  onExpandRef.current = onExpand;

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: chartColors.background },
        textColor: chartColors.text,
        attributionLogo: true,
      },
      grid: {
        vertLines: { visible: false, color: chartColors.background },
        horzLines: { visible: false, color: chartColors.background },
      },
      rightPriceScale: {
        borderColor: chartColors.border,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: chartColors.border,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: chartColors.crosshair, width: 1, style: 2 },
        horzLine: { color: chartColors.crosshair, width: 1, style: 2 },
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: chartColors.background,
      downColor: chartColors.down,
      borderVisible: true,
      borderUpColor: chartColors.up,
      borderDownColor: chartColors.down,
      wickUpColor: chartColors.up,
      wickDownColor: chartColors.down,
      priceLineVisible: true,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries as CandleSeries;

    const handleDoubleClick = () => {
      onExpandRef.current?.();
    };

    chart.subscribeDblClick(handleDoubleClick);

    const resizeChart = () => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resizeChart);

    if (resizeObserver) {
      resizeObserver.observe(container);
    } else {
      window.addEventListener("resize", resizeChart);
      resizeChart();
    }

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resizeChart);
      chart.unsubscribeDblClick(handleDoubleClick);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lastFitKeyRef.current = null;
      previousDataRef.current = null;
    };
  }, []);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;

    if (!candleSeries) {
      return;
    }

    const candleData = toChartData(candles);
    const previousData = previousDataRef.current;
    const canUpdateIncrementally = previousData?.viewKey === viewKey
      && supportsIncrementalUpdate(previousData.candleData, candleData);

    if (canUpdateIncrementally) {
      candleSeries.update(candleData[candleData.length - 1]);
    } else {
      candleSeries.setData(candleData);
    }

    previousDataRef.current = { viewKey, candleData };

    if (!canUpdateIncrementally && lastFitKeyRef.current !== viewKey) {
      chartRef.current?.timeScale().fitContent();
      lastFitKeyRef.current = viewKey;
    }
  }, [dataSignature, viewKey]);

  const chartSummary = latestCandle
    ? `${symbol} candlestick chart with ${candles.length} candles. Latest close ${latestCandle.close.toFixed(2)}.`
    : `${symbol} candlestick chart with no data.`;

  return <div ref={containerRef} className="chart-canvas" role="img" aria-label={chartSummary} />;
}
