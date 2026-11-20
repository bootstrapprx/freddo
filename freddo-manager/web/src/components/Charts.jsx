import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

const PALETTE = ["#cba6f7", "#89b4fa", "#a6e3a1", "#f9e2af", "#f38ba8", "#94e2d5"];

export function LineChart({ series = [], height = 200, unit = "" }) {
  const holder = useRef(null);

  const { aligned, width } = useMemo(() => {
    const timestamps = [...new Set(series.flatMap((item) => item.points.map((point) => point.ts)))].sort((a, b) => a - b);
    const data = [timestamps];
    for (const item of series) {
      const values = new Map(item.points.map((point) => [point.ts, point.value]));
      data.push(timestamps.map((ts) => (values.has(ts) ? values.get(ts) : null)));
    }
    return { aligned: data, width: holder.current?.clientWidth || 640 };
  }, [series]);

  useEffect(() => {
    if (!holder.current) return undefined;
    const options = {
      width: holder.current.clientWidth,
      height,
      padding: [14, 12, 0, 0],
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: true } },
      axes: [
        { stroke: "#7f849c", grid: { stroke: "#313244", width: 1 }, values: (_, values) => values.map((v) => new Date(v * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })) },
        { stroke: "#7f849c", grid: { stroke: "#313244", width: 1 }, values: (_, values) => values.map((v) => `${v?.toFixed?.(1) ?? v}${unit}`) },
      ],
      series: [
        {},
        ...series.map((item, index) => ({
          label: item.name,
          stroke: item.color || PALETTE[index % PALETTE.length],
          width: 2,
          points: { show: false },
          fill: `${item.color || PALETTE[index % PALETTE.length]}18`,
          spanGaps: true,
        })),
      ],
      legend: { show: series.length > 1 },
    };
    const plot = new uPlot(options, aligned, holder.current);
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth) plot.setSize({ width: Math.floor(nextWidth), height });
    });
    observer.observe(holder.current);
    return () => {
      observer.disconnect();
      plot.destroy();
    };
  }, [aligned, height, series, unit]);

  return <div ref={holder} className="w-full overflow-hidden" style={{ height }} />;
}

export function Sparkline({ values = [], color = "#cba6f7", height = 36 }) {
  if (values.length < 2) return <div style={{ height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => `${(index / (values.length - 1)) * 100},${height - ((value - min) / range) * (height - 4) - 2}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} className="w-full">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
