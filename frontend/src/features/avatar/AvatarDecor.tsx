import { avatarColors, type AvatarConfig } from './model.ts';
const note = ['....#', '...##', '...#.', '...#.', '...#.', '...#.', '.###.', '.###.'];
const beamed = [
  '#########',
  '#########',
  '#......#.',
  '#......#.',
  '#......#.',
  '#......#.',
  '###...###',
  '###...###',
];
const guitar = [
  '..kttk..',
  '..kttk..',
  '..kttk..',
  '..kttk..',
  '..kttk..',
  '..kttk..',
  '.k4BB4k.',
  'kBBBBBBk',
  'k444444k',
  'kTTTTTTk',
  'kttttttk',
  '.kkkkkk.',
];
const guitarColors: Record<string, string> = {
  k: '#3F3A33',
  t: '#7A5540',
  '4': '#857058',
  B: '#2E2A24',
  T: '#A8785E',
};
function Stamp({ shape, x, y, fill }: { shape: string[]; x: number; y: number; fill: string }) {
  return (
    <g fill={fill}>
      {shape.flatMap((row, r) =>
        Array.from(row).map((symbol, c) =>
          symbol === '#' ? (
            <rect key={`${r}:${c}`} x={(x + c) * 4} y={(y + r) * 4} width="4" height="4" />
          ) : null,
        ),
      )}
    </g>
  );
}
// 按 zyr 原版的坐标、透明度和像素图案绘制固定音乐装饰。
export function AvatarDecor({ config }: { config: AvatarConfig }) {
  const color = avatarColors(config),
    light = color.M!,
    primary = color.P!,
    dark = color.D!;
  return (
    <g>
      <rect width="240" height="288" fill={light} opacity="0.22" />
      <ellipse cx="120" cy="148" rx="70" ry="92" fill={light} opacity="0.55" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i} fill={dark} opacity="0.28">
          <rect y={20 + i * 5} width="70" height="1" />
          <rect x="170" y={20 + i * 5} width="30" height="1" />
        </g>
      ))}
      <g fill={dark} opacity="0.3">
        <rect x="70" y="20" width="1" height="20" />
        <rect x="170" y="20" width="1" height="20" />
      </g>
      <circle cx="22" cy="22" r="16" fill="#1a1a1a" />
      {[14, 11, 7].map((r, i) => (
        <circle
          key={r}
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="#3a3a3a"
          strokeWidth={i ? '0.6' : '0.8'}
          opacity={0.7 - i * 0.15}
        />
      ))}
      <circle cx="22" cy="22" r="2.5" fill={primary} />
      <path
        d="M10 14 A13 13 0 0 1 18 10"
        stroke="white"
        strokeWidth="1.2"
        fill="none"
        opacity="0.25"
      />
      <g opacity="0.85">
        <Stamp shape={note} x={8} y={9} fill={primary} />
        <Stamp shape={note} x={0} y={14} fill={primary} />
        <Stamp shape={note} x={56} y={0} fill="#C9A878" />
      </g>
      {guitar.flatMap((row, r) =>
        Array.from(row).map((symbol, c) =>
          guitarColors[symbol] ? (
            <rect
              key={`${r}:${c}`}
              x={(52 + c) * 4}
              y={(2 + r) * 4}
              width="4"
              height="4"
              fill={guitarColors[symbol]}
            />
          ) : null,
        ),
      )}
      <g opacity="0.8">
        <Stamp shape={beamed} x={52} y={14} fill={dark} />
      </g>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect
          key={i}
          x={i * 12}
          y="268"
          width="12"
          height="16"
          fill="#F4EDE3"
          stroke="#3F3A33"
          strokeWidth="0.4"
        />
      ))}
      {[3, 6, 15].map((x) => (
        <rect key={x} x={(x - 0.5) * 4} y="268" width="6" height="10" fill="#3F3A33" />
      ))}
      <rect y="266.5" width="72" height="1" fill="#C9A878" opacity="0.6" />
      {[
        [46, 5, primary],
        [49, 8, dark],
        [52, 4, primary],
        [55, 6, '#C9A878'],
      ].map(([x, h, fill]) => (
        <g key={x}>
          <rect
            x={Number(x) * 4}
            y={(71 - Number(h)) * 4}
            width="8"
            height={Number(h) * 4}
            fill={String(fill)}
            opacity="0.85"
          />
          <rect
            x={Number(x) * 4}
            y={(71 - Number(h)) * 4}
            width="8"
            height="4"
            fill="white"
            opacity="0.4"
          />
        </g>
      ))}
      <rect x="180" y="284" width="56" height="1" fill={dark} opacity="0.6" />
      {[0, 1, 2, 3].map((i) => (
        <circle key={i} cx={(47 + i * 3) * 4} cy="287" r="1.6" fill={dark} opacity="0.7" />
      ))}
      <circle cx="216" cy="112" r="6" fill="none" stroke={dark} strokeWidth="1.2" opacity="0.55" />
      <circle cx="216" cy="112" r="2" fill={primary} opacity="0.65" />
      {[
        [0, -10],
        [4, -8],
        [-4, 6],
        [0, 8],
      ].map(([x, y]) => (
        <circle key={`${x}:${y}`} cx={216 + x} cy={112 + y} r="1" fill={primary} opacity="0.55" />
      ))}
      {[12, 34].map((x) => (
        <g key={x} opacity="0.55">
          <circle cx={x} cy="128" r="5" fill="none" stroke={dark} />
          <circle cx={x} cy="128" r="2" fill={primary} />
        </g>
      ))}
      <rect x="16" y="127.5" width="14" height="1" fill={dark} opacity="0.45" />
      <g opacity="0.7">
        <Stamp shape={beamed} x={0} y={60} fill={dark} />
        <Stamp shape={note} x={55} y={62} fill={primary} />
      </g>
      {[
        [5, 6],
        [56, 6],
        [5, 65],
        [57, 65],
        [30, 1],
        [32, 1],
        [30, 70],
        [32, 70],
      ].map(([x, y]) => (
        <rect
          key={`${x}:${y}`}
          x={x * 4 - 1}
          y={y * 4 - 1}
          width="2"
          height="2"
          fill="#C9A878"
          opacity="0.85"
        />
      ))}
    </g>
  );
}
