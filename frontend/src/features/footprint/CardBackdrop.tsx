// 静态 SVG 背景复现来源卡片的渐变与柔光；所有颜色仅在主题表中定义。
export function CardBackdrop({
  uid,
  height,
  width = 480,
}: {
  uid: string;
  height: number;
  width?: number;
}) {
  return (
    <>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2=".85" y2="1">
          <stop offset="0%" stopColor="var(--fp-card-stop-1)" />
          <stop offset="48%" stopColor="var(--fp-card-stop-2)" />
          <stop offset="100%" stopColor="var(--fp-card-stop-3)" />
        </linearGradient>
        {[
          { suffix: 'b1', cx: '.08', cy: '.02', r: '.72', opacity: '.92' },
          { suffix: 'b2', cx: '.95', cy: '.3', r: '.6', opacity: '.95' },
          { suffix: 'b3', cx: '.72', cy: '1', r: '.62', opacity: '.78' },
        ].map(({ suffix, cx, cy, r, opacity }, index) => (
          <radialGradient key={suffix} id={`${uid}-${suffix}`} cx={cx} cy={cy} r={r}>
            <stop
              offset="0%"
              stopColor={`var(--fp-card-blob-${index + 1})`}
              stopOpacity={opacity}
            />
            <stop offset="100%" stopColor={`var(--fp-card-blob-${index + 1})`} stopOpacity="0" />
          </radialGradient>
        ))}
        <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0%" stopColor="var(--fp-card-white)" stopOpacity=".55" />
          <stop offset="42%" stopColor="var(--fp-card-white)" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx=".86" cy=".06" r=".55">
          <stop offset="0%" stopColor="var(--fp-card-accent)" stopOpacity=".16" />
          <stop offset="100%" stopColor="var(--fp-card-accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {['', '-b1', '-b3', '-b2', '-glow', '-sheen'].map((suffix) => (
        <rect key={suffix} width={width} height={height} rx="22" fill={`url(#${uid}${suffix})`} />
      ))}
    </>
  );
}
