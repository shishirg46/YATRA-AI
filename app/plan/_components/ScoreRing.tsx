"use client";

export default function ScoreRing({ score, size = 72 }: { score: number; size?: number }) {
  const color = score >= 80 ? "#34d399" : score >= 60 ? "#f59e0b" : score >= 40 ? "#fb923c" : "#f87171";
  const r = size * 0.4; const circ = 2 * Math.PI * r; const half = size / 2;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={half} cy={half} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4.5"/>
        <circle cx={half} cy={half} r={r} fill="none" stroke={color} strokeWidth="4.5"
          strokeDasharray={`${(score/100)*circ} ${circ}`} strokeLinecap="round"/>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-bold text-white" style={{ fontSize: size * 0.22 }}>{score}</span>
        <span className="font-body text-slate-500" style={{ fontSize: size * 0.12 }}>/100</span>
      </div>
    </div>
  );
}
