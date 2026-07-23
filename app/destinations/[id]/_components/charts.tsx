"use client";

// ── SVG Mini Charts for Destination Detail Page ───────────────────────────────

interface DataPoint { value: number; label?: string }

export function Sparkline({ data, color = "#f59e0b", height = 48, width = 200 }: {
  data: DataPoint[]; color?: string; height?: number; width?: number;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  const min = Math.min(...data.map(d => d.value), 0);
  const range = max - min || 1;
  const pad = 4;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const points = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * w;
    const y = pad + h - ((d.value - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");

  const areaPoints = `${pad},${pad + h} ${points} ${pad + w},${pad + h}`;

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`grad-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#grad-${color.replace('#','')})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {data.length > 0 && (() => {
        const lastX = pad + ((data.length - 1) / (data.length - 1)) * w;
        const lastY = pad + h - ((data[data.length - 1].value - min) / range) * h;
        return <circle cx={lastX} cy={lastY} r="3" fill={color} />;
      })()}
    </svg>
  );
}

export function BarChart({ data, color = "#38bdf8", height = 80, width = 300, label }: {
  data: DataPoint[]; color?: string; height?: number; width?: number; label?: string;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map(d => d.value), 0.1);
  const pad = 4;
  const w = width - pad * 2;
  const h = height - pad * 2 - 12;
  const barW = Math.max(2, (w / data.length) - 2);

  return (
    <div>
      {label && <p className="font-body text-[10px] text-slate-600 mb-1">{label}</p>}
      <svg width={width} height={height}>
        {data.map((d, i) => {
          const barH = (d.value / max) * h;
          const x = pad + (i / data.length) * w + 1;
          const y = pad + h - barH;
          return (
            <rect key={i} x={x} y={y} width={barW} height={barH}
              rx="1" fill={color} opacity="0.7" />
          );
        })}
        <line x1={pad} y1={pad + h} x2={pad + w} y2={pad + h}
          stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      </svg>
    </div>
  );
}

export function HazardBars({ data, height = 60, width = 300 }: {
  data: { label: string; value: number; color: string }[];
  height?: number; width?: number;
}) {
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label}>
          <div className="flex items-center justify-between mb-0.5">
            <span className="font-body text-xs text-slate-400">{d.label}</span>
            <span className="font-body text-xs text-slate-500">{(d.value * 100).toFixed(0)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(d.value * 100, 100)}%`, background: d.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PenaltyBreakdown({ penalties }: {
  penalties: Record<string, number>;
}) {
  const sorted = Object.entries(penalties)
    .filter(([, v]) => v > 0.5)
    .sort(([, a], [, b]) => b - a);

  if (sorted.length === 0) {
    return <p className="font-body text-xs text-slate-500">No significant penalties — conditions are favourable.</p>;
  }

  const maxP = Math.max(...sorted.map(([, v]) => v), 1);
  const labels: Record<string, string> = {
    altitude: "Altitude", remoteness: "Remoteness", seismicZone: "Seismic Zone",
    airBaseline: "Air Quality (baseline)", rainfall: "Rainfall", wind: "Wind",
    temperature: "Temperature", flood: "Flood Risk", landslide: "Landslide Risk",
    earthquake: "Earthquake", heatIndex: "Heat Index", airQuality: "Air Quality (live)",
  };
  const colors: Record<string, string> = {
    flood: "#3b82f6", landslide: "#f97316", earthquake: "#ef4444", altitude: "#a78bfa",
    rainfall: "#38bdf8", wind: "#94a3b8", temperature: "#fb923c", seismicZone: "#f87171",
    remoteness: "#818cf8", airBaseline: "#64748b", airQuality: "#64748b", heatIndex: "#fbbf24",
  };

  return (
    <div className="space-y-2">
      {sorted.map(([key, val]) => (
        <div key={key}>
          <div className="flex items-center justify-between mb-0.5">
            <span className="font-body text-xs text-slate-400">{labels[key] ?? key}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${(val / maxP) * 100}%`, background: colors[key] ?? "#f59e0b" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
