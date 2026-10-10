import React, { useMemo, useState } from 'react';

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  /** [time s, value] */
  points: readonly [number, number][];
  /** Draw a marker on every point (sparse series) */
  markers?: boolean;
}

export interface ChartThreshold {
  value: number;
  label: string;
}

export interface TimeSeriesChartProps {
  series: ChartSeries[];
  thresholds?: ChartThreshold[];
  durationS: number;
  unit: string;
  width?: number;
  height?: number;
}

const PAD = { left: 30, right: 8, top: 8, bottom: 20 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Value at time t on a polyline (linear between points). */
function valueAt(points: readonly [number, number][], t: number): number | null {
  if (points.length === 0) return null;
  if (t <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i]!;
    if (t <= t1) {
      const [t0, v0] = points[i - 1]!;
      return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
    }
  }
  return points[points.length - 1]![1];
}

/**
 * Small single-axis line chart: concentration over time with dashed threshold rules, a legend and a
 * hover crosshair + tooltip. Text stays in neutral ink; colour only marks series identity.
 */
export const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({ series, thresholds = [], durationS, unit, width = 272, height = 150 }) => {
  const [hoverT, setHoverT] = useState<number | null>(null);
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const yMax = useMemo(() => {
    let m = 0;
    for (const s of series) for (const [, v] of s.points) m = Math.max(m, v);
    for (const th of thresholds) if (th.value <= m * 1.6) m = Math.max(m, th.value);
    return niceMax(m * 1.08);
  }, [series, thresholds]);

  const x = (t: number) => PAD.left + (t / durationS) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;
  const yTicks = [0, yMax / 2, yMax];
  const hours = durationS / 3600;
  const xStep = hours <= 2 ? 0.5 : hours <= 4 ? 1 : 2;
  const xTicks: number[] = [];
  for (let h = 0; h <= hours + 1e-9; h += xStep) xTicks.push(h * 3600);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const t = ((px - PAD.left) / plotW) * durationS;
    setHoverT(t < 0 || t > durationS ? null : t);
  };

  return (
    <div className="flex flex-col gap-1" data-testid="sim-timeseries-chart">
      {/* Legend (two series: always present, identity never by colour alone) */}
      <div className="flex items-center gap-3 text-[10px] text-neutral-300">
        {series.map((s) => (
          <span key={s.id} className="flex items-center gap-1">
            <span className="inline-block w-3 h-[2px] rounded" style={{ background: s.color }} />
            {s.markers && <span className="inline-block w-2 h-2 rounded-full -ml-2" style={{ background: s.color }} />}
            {s.label}
          </span>
        ))}
      </div>
      <div className="relative">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHoverT(null)}
          role="img"
          aria-label={`PM2.5 over ${hours} hours`}
        >
          {/* Recessive grid + y axis labels */}
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.08)" />
              <text x={PAD.left - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#a3a3a3">
                {Math.round(v)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={height - 6} textAnchor="middle" fontSize={9} fill="#a3a3a3">
              {t / 3600}h
            </text>
          ))}
          {/* Threshold rules, labelled in text */}
          {thresholds
            .filter((th) => th.value <= yMax)
            .map((th) => (
              <g key={th.label}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(th.value)} y2={y(th.value)} stroke="#a3a3a3" strokeDasharray="3 3" strokeWidth={1} />
                <text x={width - PAD.right - 2} y={y(th.value) - 3} textAnchor="end" fontSize={9} fill="#d4d4d4">
                  {th.label}
                </text>
              </g>
            ))}
          {/* Series */}
          {series.map((s) => (
            <g key={s.id}>
              <polyline
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={s.points.map(([t, v]) => `${x(t)},${y(v)}`).join(' ')}
              />
              {s.markers &&
                s.points.map(([t, v]) => <circle key={t} cx={x(t)} cy={y(v)} r={4} fill={s.color} stroke="#171717" strokeWidth={2} />)}
            </g>
          ))}
          {/* Crosshair */}
          {hoverT !== null && <line x1={x(hoverT)} x2={x(hoverT)} y1={PAD.top} y2={PAD.top + plotH} stroke="rgba(255,255,255,0.35)" />}
          <text x={PAD.left} y={PAD.top - 1} fontSize={9} fill="#a3a3a3" dominantBaseline="hanging" dx={2}>
            {unit}
          </text>
        </svg>
        {hoverT !== null && (
          <div
            className="pointer-events-none absolute top-1 px-1.5 py-1 rounded bg-black/85 border border-white/10 text-[10px] text-neutral-200 whitespace-nowrap"
            style={{ left: Math.min(x(hoverT) + 6, width - 110) }}
          >
            <div className="text-neutral-400">{(hoverT / 60).toFixed(0)} min</div>
            {series.map((s) => {
              const v = valueAt(s.points, hoverT);
              return v === null ? null : (
                <div key={s.id} className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.color }} />
                  {s.label}: {v.toFixed(1)} {unit}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
