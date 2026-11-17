import { useId } from 'react';

export function ListeningHours({ hourly }: { hourly: number[] }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const values = Array.from({ length: 24 }, (_, i) => hourly[i] || 0);
  const peak = Math.max(1, ...values);
  const peakHour = values.indexOf(Math.max(...values));
  const points = values.map((plays, hour) => ({
    x: 6 + (hour / 23) * 548,
    y: 126 - (plays / peak) * 110,
  }));
  let line = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      mid = ((a.x + b.x) / 2).toFixed(1);
    line += ` C ${mid} ${a.y.toFixed(1)}, ${mid} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  const top = points[peakHour];
  return (
    <svg
      className="fp-hours-svg"
      viewBox="0 0 560 132"
      width="100%"
      height="132"
      role="img"
      aria-label={`按小时统计的播放次数曲线，峰值在 ${peakHour} 点`}
    >
      <defs>
        <linearGradient id={`${uid}-line`}>
          <stop offset="0%" stopColor="var(--fp-ms-gold)" />
          <stop offset="100%" stopColor="var(--fp-ms-gold-end)" />
        </linearGradient>
        <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--fp-ms-gold)" stopOpacity=".34" />
          <stop offset="100%" stopColor="var(--fp-ms-gold)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((ratio) => (
        <line
          key={ratio}
          x1="0"
          x2="560"
          y1={132 * ratio}
          y2={132 * ratio}
          stroke="var(--hairline)"
          strokeDasharray="2 6"
        />
      ))}
      <path
        className="fp-hours-area"
        d={`${line} L 554 132 L 6 132 Z`}
        fill={`url(#${uid}-area)`}
      />
      <path
        className="fp-hours-line"
        d={line}
        fill="none"
        stroke={`url(#${uid}-line)`}
        strokeWidth="2.4"
        strokeLinecap="round"
        pathLength="1700"
      />
      <circle
        className="fp-hours-peak"
        cx={top.x}
        cy={top.y}
        r="4.5"
        fill="var(--amber)"
        stroke="var(--paper)"
        strokeWidth="2"
      />
      <text
        className="fp-hours-peak-label"
        x={Math.min(520, Math.max(30, top.x))}
        y={Math.max(14, top.y - 12)}
        textAnchor="middle"
      >
        {peakHour} 点 · {values[peakHour]} 次
      </text>
    </svg>
  );
}

export function ListeningStreak({ days, activeDays }: { days: number; activeDays: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const length = 2 * Math.PI * 52;
  const ratio = Math.min(1, days / Math.max(7, Math.min(activeDays, 21)));
  return (
    <svg
      className="fp-ring"
      viewBox="0 0 130 130"
      width="130"
      height="130"
      role="img"
      aria-label={`连续听歌 ${days} 天`}
    >
      <defs>
        <linearGradient id={`${uid}-ring`} x2="1" y2="1">
          <stop offset="0%" stopColor="var(--fp-ms-gold)" />
          <stop offset="100%" stopColor="var(--fp-ms-gold-end)" />
        </linearGradient>
      </defs>
      <circle cx="65" cy="65" r="52" fill="none" stroke="var(--hairline)" strokeWidth="7" />
      <circle
        className="fp-ring-progress"
        cx="65"
        cy="65"
        r="52"
        fill="none"
        stroke={`url(#${uid}-ring)`}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${length * ratio} ${length}`}
        transform="rotate(-90 65 65)"
      />
      <text x="65" y="60" textAnchor="middle" className="fp-ring-num">
        {days}
      </text>
      <text x="65" y="80" textAnchor="middle" className="fp-ring-cap">
        连续 · 天
      </text>
    </svg>
  );
}
