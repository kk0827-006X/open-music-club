import type { RefObject } from 'react';
import { Icon } from '../../shared/react/ui.tsx';
import { replaceBrokenCover } from '../../shared/react/image.ts';
import { formatPlaybackTime as clock } from '../../shared/format.ts';
import type { PlayerDisplay, PlayerDisplayActions, PlayerPreview } from './types.ts';
import { VolumeSlider } from '../../shared/react/controls.tsx';

// 只呈现状态与转交动作，焦点和异步生命周期由上层 hook 持有。
export function CompactPlayer({
  display,
  actions,
  refs,
  selectedAlbum,
}: {
  display: PlayerDisplay;
  selectedAlbum: PlayerPreview;
  actions: PlayerDisplayActions;
  refs: {
    footerRef: RefObject<HTMLElement | null>;
    compactOpenButtonRef: RefObject<HTMLButtonElement | null>;
    queueToggleRef: RefObject<HTMLButtonElement | null>;
    openButtonRef: RefObject<HTMLButtonElement | null>;
  };
}) {
  const {
    state,
    expanded,
    playerVisible,
    queueOpen,
    liked,
    playerLikeDisabled,
    previousDisabled,
    nextDisabled,
    volumeValue,
    queueCount,
  } = display;
  const activeTrack = state.track;
  const previewTrack = selectedAlbum.tracks[0];
  const sourceLabel = activeTrack
    ? activeTrack.source === 'local'
      ? 'LOCAL'
      : 'NETEASE'
    : 'NETEASE';
  const footerTitle = activeTrack?.title ?? previewTrack?.title ?? '尚未播放歌曲';
  const footerMeta = activeTrack
    ? `${activeTrack.artist} / ${activeTrack.album}`
    : `${selectedAlbum.artist}\u00a0\u00a0/\u00a0\u00a0${selectedAlbum.title}`;
  const footerCover = activeTrack?.coverUrl ?? selectedAlbum.coverUrl;
  const footerCoverAlt = activeTrack
    ? `${activeTrack.title} 封面缩略图`
    : `${selectedAlbum.title} 封面缩略图`;
  const footerCurrent = activeTrack ? clock(state.currentTime) : '0:00';
  const footerEnd = activeTrack
    ? Number.isFinite(state.duration)
      ? clock(state.duration)
      : activeTrack.duration
    : (previewTrack?.duration.replace(/^0/, '') ?? '0:00');
  const progressPercent =
    activeTrack && Number.isFinite(state.duration) && state.duration > 0
      ? `${Math.min(100, (state.currentTime / state.duration) * 100)}%`
      : '0%';
  const {
    onFooterClick,
    setExpanded,
    onPlayerLike,
    playPrevious,
    playNext,
    togglePlayback,
    seekToPointer,
    changeVolume,
    onPlayerQueueToggle,
  } = actions;
  const { footerRef, compactOpenButtonRef, queueToggleRef, openButtonRef } = refs;
  return (
    <footer
      ref={footerRef}
      className={`global-player${playerVisible || expanded ? ' is-visible' : ''}`}
      data-global-player
      aria-hidden={expanded}
      inert={expanded ? true : undefined}
      aria-label="全站播放器"
      onClick={onFooterClick}
    >
      <section className="player-track" data-player-track>
        <img src={footerCover} alt={footerCoverAlt} onError={replaceBrokenCover} />
        <div>
          <button
            ref={compactOpenButtonRef}
            type="button"
            className="player-track-copy"
            data-player-open-compact
            aria-label={`展开播放器与歌词：${footerTitle}`}
            onClick={() => setExpanded(true)}
          >
            <strong>{footerTitle}</strong>
            <span>{footerMeta}</span>
          </button>
        </div>
        <b>
          <i />
          {sourceLabel}
        </b>
        <button
          type="button"
          data-player-like
          aria-label={liked ? '取消收藏歌曲' : '收藏歌曲'}
          aria-pressed={liked}
          disabled={playerLikeDisabled}
          onClick={onPlayerLike}
        >
          <Icon name="heart" filled={liked} />
        </button>
      </section>
      <section className="player-timeline" data-player-progress>
        <time>{footerCurrent}</time>
        <button
          type="button"
          data-player-progress-bar
          aria-label="播放进度"
          disabled={!activeTrack || !Number.isFinite(state.duration)}
          onClick={seekToPointer}
        >
          <i style={{ width: progressPercent }} />
          <b style={{ left: progressPercent }} />
        </button>
        <time>{footerEnd}</time>
      </section>
      <section className="player-controls" data-player-controls>
        <button
          type="button"
          data-player-previous
          aria-label="上一首"
          disabled={previousDisabled}
          onClick={playPrevious}
        >
          <Icon name="previous" />
        </button>
        <button
          type="button"
          className="player-main-control"
          data-player-toggle
          aria-label={activeTrack && !state.paused ? '暂停' : '播放'}
          onClick={togglePlayback}
        >
          <Icon name={activeTrack && !state.paused ? 'pause' : 'play'} />
        </button>
        <button
          type="button"
          data-player-next
          aria-label="下一首"
          disabled={nextDisabled}
          onClick={playNext}
        >
          <Icon name="next" />
        </button>
      </section>
      <section className="player-volume" data-player-volume>
        <Icon name="volume" />
        <VolumeSlider value={volumeValue} onChange={changeVolume} />
      </section>
      <button
        ref={queueToggleRef}
        type="button"
        className="player-queue-summary"
        data-player-queue-toggle
        aria-expanded={queueOpen}
        aria-controls="player-queue-panel"
        onClick={onPlayerQueueToggle}
      >
        <Icon name="queue" />
        <span data-queue-count>{queueCount}</span>
      </button>
      <div className="player-tail">
        <p>
          GOOD MUSIC
          <br />
          FOR A BRIGHTER TOMORROW.
        </p>
        <button
          ref={openButtonRef}
          type="button"
          className="player-open"
          data-player-open
          aria-label="展开播放器与歌词"
          onClick={() => setExpanded(true)}
        >
          展开歌词{' '}
          <span>
            <Icon name="open" />
          </span>
        </button>
      </div>
    </footer>
  );
}
