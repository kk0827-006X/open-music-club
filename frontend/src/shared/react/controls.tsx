import * as Slider from '@radix-ui/react-slider'
import type { CSSProperties } from 'react'

// Radix 提供指针捕获、触屏和方向键，外观继续使用本站颜色与轨道尺寸。
export function VolumeSlider({ value, onChange }: { value: number; onChange(value: number): void }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return <Slider.Root className="player-volume-slider" min={0} max={100} step={1} value={[percent]} onValueChange={values => onChange(values[0] / 100)} style={{ '--volume-percent': `${percent}%` } as CSSProperties}>
    <Slider.Track className="player-volume-slider-track"><Slider.Range className="player-volume-slider-range" /></Slider.Track>
    <Slider.Thumb className="player-volume-slider-thumb" data-player-volume-input aria-label="音量" />
  </Slider.Root>
}
