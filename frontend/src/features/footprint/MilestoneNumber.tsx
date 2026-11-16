import { useEffect, useState } from 'react';
import { useReducedMotion } from '../../shared/react/hooks.ts';

// 数字动效独立管理帧生命周期，隐藏、卸载或减少动态效果时立即停止。
export function MilestoneNumber({ value, active }: { value: number; active: boolean }) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (!active || reduced) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 950);
      setDisplay(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, active, reduced]);
  return <span aria-label={String(value)}>{reduced || !active ? value : display}</span>;
}
