import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "../../types/market";

interface PriceChartProps {
  candles: Candle[];
  symbol: string;
}

const chartColors = {
  background: "#101a20",
  text: "#91a4aa",
  grid: "#1e2d33",
  border: "#2b3c42",
  up: "#57d6b2",
  down: "#ff8b6f",
};

export default function PriceChart({ candles, symbol }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const latestCandle = candles[candles.length - 1];

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
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: chartColors.grid },
        horzLines: { color: chartColors.grid },
      },
      rightPriceScale: {
        borderColor: chartColors.border,
        scaleMargins: { top: 0.08, bottom: 0.24 },
      },
      timeScale: {
        borderColor: chartColors.border,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "#c8a96b", width: 1, style: 2 },
        horzLine: { color: "#c8a96b", width: 1, style: 2 },
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: chartColors.up,
      downColor: chartColors.down,
      borderVisible: false,
      wickUpColor: chartColors.up,
      wickDownColor: chartColors.down,
      priceLineVisible: true,
      lastValueVisible: true,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      base: 0,
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    candleSeries.setData(
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );

    volumeSeries.setData(
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        value: candle.volume,
        color: candle.close >= candle.open ? "#2d8875" : "#9e4e48",
      })),
    );

    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [candles]);

  const chartSummary = latestCandle
    ? `${symbol} candlestick chart with ${candles.length} candles. Latest close ${latestCandle.close.toFixed(2)}.`
    : `${symbol} candlestick chart with no data.`;

  return <div ref={containerRef} className="chart-canvas" role="img" aria-label={chartSummary} />;
}
