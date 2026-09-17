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
  viewKey: string;
}

type CandlePoint = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

type VolumePoint = {
  time: UTCTimestamp;
  value: number;
  color: string;
};

type ChartViewport = {
  timeScale: () => { fitContent: () => void };
};

type CandleSeries = {
  setData: (data: CandlePoint[]) => void;
};

type VolumeSeries = {
  setData: (data: VolumePoint[]) => void;
};

const chartColors = {
  background: "#101a20",
  text: "#91a4aa",
  grid: "#1e2d33",
  border: "#2b3c42",
  up: "#57d6b2",
  down: "#ff8b6f",
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

function toChartData(candles: Candle[]) {
  let previousTime = 0;
  const candleData: CandlePoint[] = [];
  const volumeData: VolumePoint[] = [];

  candles.forEach((candle) => {
    const time = toUtcTimestamp(candle.time, previousTime);
    previousTime = time;
    candleData.push({
      time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });
    volumeData.push({
      time,
      value: candle.volume,
      color: candle.close >= candle.open ? "#2d8875" : "#9e4e48",
    });
  });

  return { candleData, volumeData };
}

export default function PriceChart({ candles, symbol, viewKey }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartViewport | null>(null);
  const candleSeriesRef = useRef<CandleSeries | null>(null);
  const volumeSeriesRef = useRef<VolumeSeries | null>(null);
  const lastFitKeyRef = useRef<string | null>(null);
  const latestCandle = candles[candles.length - 1];
  const dataSignature = candles
    .map((candle) => [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].join(":"))
    .join("|");

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

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries as CandleSeries;
    volumeSeriesRef.current = volumeSeries as VolumeSeries;

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
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      lastFitKeyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;

    if (!candleSeries || !volumeSeries) {
      return;
    }

    const { candleData, volumeData } = toChartData(candles);

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    if (lastFitKeyRef.current !== viewKey) {
      chartRef.current?.timeScale().fitContent();
      lastFitKeyRef.current = viewKey;
    }
  }, [dataSignature, viewKey]);

  const chartSummary = latestCandle
    ? `${symbol} candlestick chart with ${candles.length} candles. Latest close ${latestCandle.close.toFixed(2)}.`
    : `${symbol} candlestick chart with no data.`;

  return <div ref={containerRef} className="chart-canvas" role="img" aria-label={chartSummary} />;
}
