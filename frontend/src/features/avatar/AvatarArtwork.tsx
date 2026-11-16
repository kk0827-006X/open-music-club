import { useMemo } from 'react';
import { avatarPixels, type AvatarConfig, type AvatarPart } from './model.ts';
import { AvatarDecor } from './AvatarDecor.tsx';

export function AvatarArtwork({
  config,
  part,
  label = '像素音乐小人预览',
}: {
  config: AvatarConfig;
  part?: AvatarPart;
  label?: string;
}) {
  const pixels = useMemo(() => avatarPixels(config, part), [config, part]);
  const viewBox = '0 0 240 288';
  return (
    <svg
      className={`avatar-artwork${part ? '' : ' avatar-main-art'}`}
      viewBox={viewBox}
      role="img"
      aria-label={label}
    >
      {!part && <AvatarDecor config={config} />}
      <g shapeRendering="crispEdges">
        {pixels.map(({ x, y, fill }) =>
          fill === '#3F3A33' ? (
            <rect
              key={`${x}:${y}`}
              x={x + 2}
              y={y + 2}
              width="4"
              height="4"
              fill="none"
              stroke={fill}
              strokeWidth="0.6"
            />
          ) : (
            <rect key={`${x}:${y}`} x={x} y={y} width="8" height="8" fill={fill} />
          ),
        )}
      </g>
    </svg>
  );
}
