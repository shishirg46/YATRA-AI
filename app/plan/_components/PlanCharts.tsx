"use client";

import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, PieChart, Pie, Cell, Legend,
} from "recharts";

const LEVEL_COLORS: Record<string, string> = {
  SAFE: "#34d399",
  CAUTION: "#f59e0b",
  HIGH_RISK: "#fb923c",
  EXTREME: "#f87171",
};

const PILLAR_IDS: Record<string, string> = {
  route_historic: "Route\nHistoric",
  route_realtime: "Route\nRealtime",
  destination_safety: "Destination\nSafety",
  weather_safety: "Weather\nSafety",
  personal_safety: "Personal\nSafety",
};

export function PillarRadar({ data }: {
  data: Array<{
    id: string;
    title: string;
    maxPoints: number;
    score: number;
    level: string;
  }>;
}) {
  const chartData = data.map((p) => ({
    pillar: PILLAR_IDS[p.id] ?? p.title,
    score: Math.round((p.score / p.maxPoints) * 100),
    raw: `${p.score}/${p.maxPoints}`,
  }));
  const avgScore = chartData.reduce((s, d) => s + d.score, 0) / chartData.length;
  const avgColor = avgScore >= 80 ? LEVEL_COLORS.SAFE : avgScore >= 60 ? LEVEL_COLORS.CAUTION : avgScore >= 40 ? LEVEL_COLORS.HIGH_RISK : LEVEL_COLORS.EXTREME;

  return (
    <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
      <p className="font-body text-xs text-slate-500 mb-2">Pillar Scores (0–100%)</p>
      <ResponsiveContainer width="100%" height={260}>
        <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke="#334155" />
          <PolarAngleAxis dataKey="pillar" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 9 }} />
          <Tooltip
            contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(value: any) => [`${Math.round(value)}%`, "Score"]}
          />
          <Radar name="Score" dataKey="score" stroke={avgColor} fill={avgColor} fillOpacity={0.2} strokeWidth={2} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MemberBarChart({ members }: {
  members: Array<{
    userId: string;
    name: string;
    isLeader: boolean;
    score: number;
    level: string;
    topRisks: string[];
    healthFlags: string[];
  }>;
}) {
  const chartData = [...members]
    .sort((a, b) => b.score - a.score)
    .map((m) => ({
      name: m.name,
      score: m.score,
      fill: LEVEL_COLORS[m.level] ?? LEVEL_COLORS.SAFE,
      isLeader: m.isLeader,
      topRisk: m.topRisks[0] ?? "",
    }));

  const CustomBar = (props: { x?: number; y?: number; width?: number; height?: number; fill?: string; payload?: { fill: string } }) => {
    const { x = 0, y = 0, width = 0, height = 0, payload } = props;
    return <rect x={x} y={y} width={width} height={height} rx={4} fill={payload?.fill ?? "#34d399"} />;
  };

  return (
    <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
      <p className="font-body text-xs text-slate-500 mb-2">Member Safety Scores</p>
      <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 50)}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 80, right: 20, top: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
          <XAxis type="number" domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 10 }} />
          <YAxis type="category" dataKey="name" tick={{ fill: "#e2e8f0", fontSize: 11 }} width={70} />
          <Tooltip
            contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(value: any) => [`${Math.round(value)}/100`, "Score"]}
          />
          <Bar dataKey="score" shape={<CustomBar />} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function BudgetDonutCell({ label, value, color, total }: {
  label: string; value: number; color: string; total: number;
}) {
  const pct = total > 0 ? ((value / total) * 100).toFixed(0) : "0";
  return (
    <div className="flex items-center gap-2 text-xs font-body">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-slate-400">{label}</span>
      <span className="text-white font-semibold ml-auto">NPR {value.toLocaleString()} ({pct}%)</span>
    </div>
  );
}

export function BudgetDonut({ breakdown, total }: {
  breakdown: { accommodation: number; food: number; localTransport?: number; intercityTransport?: number; misc?: number; label: string; transport?: number };
  total: number;
}) {
  // Backward compat: old breakdown used "transport" for local transport
  const bLocal = breakdown.localTransport ?? breakdown.transport ?? 0;
  const bIntercity = breakdown.intercityTransport ?? 0;
  const bMisc = breakdown.misc ?? 0;
  const data = [
    { name: "Accommodation", value: breakdown.accommodation, color: "#3b82f6" },
    { name: "Food", value: breakdown.food, color: "#f59e0b" },
    ...(bIntercity > 0 ? [{ name: "Local Transport" as const, value: bLocal, color: "#34d399" }] : [{ name: "Transport" as const, value: bLocal, color: "#34d399" }]),
    ...(bIntercity > 0 ? [{ name: "Round Trip Transport" as const, value: bIntercity, color: "#8b5cf6" }] : []),
    ...(bMisc > 0 ? [{ name: "Miscellaneous" as const, value: bMisc, color: "#64748b" }] : []),
  ].filter((d) => d.value > 0);

  if (data.length === 0) return null;

  return (
    <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
      <p className="font-body text-xs text-slate-500 mb-2">Budget Breakdown</p>
      <div className="flex items-center gap-4">
        <ResponsiveContainer width={160} height={160}>
          <PieChart>
            <Pie
              data={data}
              cx="50%" cy="50%"
              innerRadius={40}
              outerRadius={70}
              paddingAngle={3}
              dataKey="value"
            >
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.color} stroke="transparent" />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
              formatter={(value: unknown) => [`NPR ${Number(value).toLocaleString()}`, ""]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="space-y-2 flex-1 min-w-0">
          {data.map((d) => (
            <BudgetDonutCell key={d.name} label={d.name} value={d.value} color={d.color} total={total} />
          ))}
          <div className="flex items-center gap-2 text-xs font-body pt-1 border-t border-slate-700/50">
            <span className="text-slate-500 font-semibold">Total</span>
            <span className="text-white font-semibold ml-auto">NPR {total.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AlternativeComparison({ alternatives }: {
  alternatives: Array<{
    name: string;
    safetyScore: number;
    estimatedNPR: number;
    budgetFeasible: boolean;
  }>;
}) {
  const chartData = alternatives.map((a) => ({
    name: a.name.length > 14 ? a.name.slice(0, 12) + "…" : a.name,
    Safety: a.safetyScore,
    "Budget Fit": a.budgetFeasible ? 100 : 20,
    fullName: a.name,
    cost: a.estimatedNPR,
  }));

  if (chartData.length < 2) return null;

  return (
    <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
      <p className="font-body text-xs text-slate-500 mb-2">Alternatives Comparison</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 0, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 9 }} />
          <Tooltip
            contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
            formatter={(value: unknown, name: unknown) => {
              const num = Number(value);
              const label = String(name ?? "");
              if (label === "Budget Fit") return [num >= 80 ? "Feasible" : "Over budget", label];
              return [`${num}/100`, label];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
          <Bar dataKey="Safety" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={24} />
          <Bar dataKey="Budget Fit" fill="#34d399" radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
