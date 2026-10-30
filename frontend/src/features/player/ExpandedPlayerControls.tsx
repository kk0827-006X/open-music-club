import type { CSSProperties, RefObject } from 'react'
import WakeSlider from '../../shared/react/react-bits/WakeSlider.tsx'
import { Icon } from '../../shared/react/ui.tsx'

// 只呈现现有播放器状态，所有动作仍交回同一个 PlayerController。
export function ExpandedPlayerControls(props: {
  active: boolean; playing: boolean; seekable: boolean; fraction: number; current: string; remaining: string
  previousDisabled: boolean; nextDisabled: boolean; volume: number; queueOpen: boolean; queueCount: string
  queueToggleRef: RefObject<HTMLButtonElement | null>
  onPrevious(): void; onToggle(): void; onNext(): void; onSeek(fraction: number): void
  onVolume(value: number): void; onQueue(): void
}) {
  return <div className="expanded-player-controls" aria-label="完整播放器控制">
    <div className="expanded-player-timeline">
      <input type="range" min="0" max="1000" step="1" value={Math.round(props.fraction * 1000)}
        data-expanded-progress aria-label="播放进度" aria-valuetext={`${props.current}，剩余 ${props.remaining}`}
        disabled={!props.seekable} onChange={event => props.onSeek(Number(event.target.value) / 1000)}
        style={{ '--played': `${props.fraction * 100}%` } as CSSProperties} />
      <div className="expanded-player-times"><time data-expanded-current>{props.current}</time><time data-expanded-remaining>−{props.remaining}</time></div>
    </div>
    <div className="expanded-player-transport">
      <button type="button" data-expanded-previous aria-label="上一首" disabled={props.previousDisabled} onClick={props.onPrevious}><Icon name="previous" filled /></button>
      <button type="button" data-expanded-toggle aria-label={props.playing ? '暂停' : '播放'} onClick={props.onToggle}><Icon name={props.playing ? 'playerPause' : 'playerPlay'} filled /></button>
      <button type="button" data-expanded-next aria-label="下一首" disabled={props.nextDisabled} onClick={props.onNext}><Icon name="next" filled /></button>
    </div>
    <div className="expanded-player-utilities">
      <div className="expanded-player-volume"><Icon name="volume" /><WakeSlider value={Math.round(props.volume * 100)} onChange={value => props.onVolume(value / 100)}
        min={0} max={100} step={1} bars={28} height={36} restHeight={6} gap={3} disabled={!props.active}
        ariaLabel="音量" formatValue={value => `${value}%`} fillColor="var(--player-ambient-ink)"
        trackColor="var(--player-ambient-line)" crestColor="var(--player-ambient-ink)" /></div>
      <button type="button" ref={props.queueToggleRef} data-expanded-queue-toggle aria-label="播放队列" aria-expanded={props.queueOpen}
        aria-controls="player-queue-panel" onClick={props.onQueue}><Icon name="queue" /><span>{props.queueCount}</span></button>
    </div>
  </div>
}
