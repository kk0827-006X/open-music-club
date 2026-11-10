import type { RefObject } from 'react';
import { Icon } from '../../shared/react/ui.tsx';
import { replaceBrokenCover } from '../../shared/react/image.ts';
import type { PlayerDisplay, PlayerDisplayActions } from './types.ts';
import { FALLBACK_COVER } from '../../shared/music.ts';
import { formatPlaybackTime as clock } from '../../shared/format.ts';
import { currentLyricIndex, type LyricLine } from '../../player-lyrics.ts';
import { AmbientAlbumBackground } from '../../shared/react/ambient/AmbientAlbumBackground.tsx';
import { ExpandedPlayerControls } from './ExpandedPlayerControls.tsx';

// 只呈现状态与转交动作，焦点和异步生命周期由上层 hook 持有。
export function ExpandedPlayer({
  display,
  actions,
  refs,
  lyricLines,
  lyricMessage,
}: {
  display: PlayerDisplay;
  lyricLines: LyricLine[];
  lyricMessage: string | null;
  actions: PlayerDisplayActions;
  refs: {
    expandedSectionRef: RefObject<HTMLElement | null>;
    closeButtonRef: RefObject<HTMLButtonElement | null>;
    expandedQueueToggleRef: RefObject<HTMLButtonElement | null>;
    lyricScrollRef: RefObject<HTMLDivElement | null>;
  };
}) {
  const {
    state,
    expanded,
    queueOpen,
    liked,
    playerLikeDisabled,
    previousDisabled,
    nextDisabled,
    volumeValue,
    queueCount,
  } = display;
  const activeTrack = state.track;
  const footerCurrent = activeTrack ? clock(state.currentTime) : '0:00';
  const lyricIndex = lyricLines.length ? currentLyricIndex(lyricLines, state.currentTime) : -1;
  const expandedTitle = activeTrack?.title ?? '尚未播放歌曲';
  const expandedArtist = activeTrack
    ? `${activeTrack.artist} / ${activeTrack.album}`
    : '请选择一首歌曲开始播放';
  const expandedSource = activeTrack
    ? activeTrack.source === 'local'
      ? 'LOCAL / 社区音乐'
      : 'NETEASE / 网易云音乐'
    : 'OPEN MUSIC CLUB';

  const {
    setExpanded,
    onPlayerLike,
    playPrevious,
    playNext,
    togglePlayback,
    seek,
    changeVolume,
    onPlayerQueueToggle,
  } = actions;
  const { expandedSectionRef, closeButtonRef, expandedQueueToggleRef, lyricScrollRef } = refs;
  return (
    <section
      ref={expandedSectionRef}
      className={`player-expanded${expanded ? ' is-open' : ''}`}
      data-player-expanded
      role="dialog"
      aria-label="展开播放器与歌词"
      aria-hidden={!expanded}
      inert={!expanded ? true : undefined}
    >
      <AmbientAlbumBackground active={expanded} coverUrl={activeTrack?.coverUrl} />
      <header className="player-expanded-header">
        <div>
          <strong>OPEN MUSIC CLUB</strong>
          <span>MUSIC ARCHIVE / NOW PLAYING</span>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          data-player-close
          aria-label="收起播放器"
          onClick={() => setExpanded(false, true)}
        >
          <span className="sr-only">收起播放器</span>
          <Icon name="chevronDown" />
        </button>
      </header>
      <div className="player-expanded-content">
        <section className="player-expanded-track" aria-label="当前歌曲">
          <img
            data-expanded-cover
            src={activeTrack?.coverUrl ?? FALLBACK_COVER}
            alt={activeTrack ? `${activeTrack.title} 封面` : '当前歌曲封面'}
            onError={replaceBrokenCover}
          />
          <div className="player-expanded-title-row">
            <div className="player-expanded-copy">
              <strong data-expanded-title>{expandedTitle}</strong>
              <span data-expanded-artist>{expandedArtist}</span>
            </div>
            <div className="player-expanded-track-actions">
              <button
                type="button"
                data-expanded-like
                aria-label={liked ? '取消收藏歌曲' : '收藏歌曲'}
                aria-pressed={liked}
                disabled={playerLikeDisabled}
                onClick={onPlayerLike}
              >
                <Icon name="heart" filled={liked} />
              </button>
              <button type="button" data-expanded-more aria-label="更多选项" disabled>
                <Icon name="more" filled />
              </button>
            </div>
          </div>
          <small className="sr-only" data-expanded-source>
            {expandedSource}
          </small>
          <ExpandedPlayerControls
            active={expanded}
            playing={Boolean(activeTrack && !state.paused)}
            seekable={Boolean(activeTrack && Number.isFinite(state.duration) && state.duration > 0)}
            fraction={
              activeTrack && Number.isFinite(state.duration) && state.duration > 0
                ? Math.min(1, Math.max(0, state.currentTime / state.duration))
                : 0
            }
            current={footerCurrent}
            remaining={clock(
              Number.isFinite(state.duration) ? Math.max(0, state.duration - state.currentTime) : 0,
            )}
            previousDisabled={previousDisabled}
            nextDisabled={nextDisabled}
            volume={volumeValue}
            queueOpen={queueOpen}
            queueCount={queueCount}
            queueToggleRef={expandedQueueToggleRef}
            onPrevious={playPrevious}
            onToggle={togglePlayback}
            onNext={playNext}
            onSeek={seek}
            onVolume={changeVolume}
            onQueue={onPlayerQueueToggle}
          />
        </section>
        <section className="player-expanded-lyrics" aria-label="歌词">
          <div
            className="player-lyrics-scroll"
            data-player-lyrics
            aria-live="off"
            ref={lyricScrollRef}
          >
            {state.error ? (
              <p className="player-lyrics-empty">{state.error}</p>
            ) : lyricMessage || lyricLines.length === 0 ? (
              <p className="player-lyrics-empty">{lyricMessage ?? '此歌曲暂无歌词。'}</p>
            ) : (
              lyricLines.map((line, index) => (
                <p
                  key={`${index}-${line.time}`}
                  className={index === lyricIndex ? 'is-current' : undefined}
                  data-lyric-distance={Math.min(3, Math.abs(index - lyricIndex))}
                >
                  <button
                    type="button"
                    aria-current={index === lyricIndex ? 'true' : undefined}
                    disabled={
                      !activeTrack || !Number.isFinite(state.duration) || state.duration <= 0
                    }
                    onClick={() => seek(line.time / state.duration)}
                  >
                    {line.text}
                  </button>
                </p>
              ))
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
