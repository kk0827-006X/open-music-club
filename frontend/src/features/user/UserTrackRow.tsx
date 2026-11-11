import type { MouseEvent } from 'react';
import { Icon } from '../../shared/react/ui.tsx';
import { toPersonalSong, type PersonalTrack } from '../../services/music/personal-library.ts';

export interface UserTrackRowProps {
  track: PersonalTrack;
  liked: boolean;
  removable: boolean;
  disabled?: boolean;
  onAction?: (action: HTMLButtonElement, track: PersonalTrack) => void;
}

export function UserTrackRow({
  track,
  liked,
  removable,
  disabled = false,
  onAction,
}: UserTrackRowProps) {
  const song = toPersonalSong(track);
  const handleAction = onAction
    ? (event: MouseEvent<HTMLButtonElement>) => onAction(event.currentTarget, track)
    : undefined;
  return (
    <article className="user-track-row">
      <img src={song.coverUrl} alt="" loading="lazy" />
      <div>
        <strong>{song.title}</strong>
        <small>
          {song.artist} / {track.source.toUpperCase()}
        </small>
      </div>
      <div className="user-track-actions">
        <button
          type="button"
          className="user-icon-button user-play-button"
          data-user-play={track.trackKey}
          aria-label={`播放 ${song.title}`}
          title={track.playable ? '播放' : '暂不可用'}
          disabled={!track.playable || disabled}
          onClick={handleAction}
        >
          <Icon name="play" />
        </button>
        <button
          type="button"
          className="user-icon-button"
          data-user-enqueue={track.trackKey}
          aria-label={`加入队列 ${song.title}`}
          title="加入队列"
          disabled={!track.playable || disabled}
          onClick={handleAction}
        >
          <Icon name="plus" />
        </button>
        <button
          type="button"
          className={`user-icon-button${liked ? ' is-liked' : ''}`}
          data-user-like={track.trackKey}
          aria-pressed={liked}
          aria-label={`${liked ? '取消收藏' : '收藏'} ${song.title}`}
          title={liked ? '取消收藏' : '收藏'}
          disabled={disabled}
          onClick={handleAction}
        >
          <Icon name="heart" filled={liked} />
        </button>
        {removable && (
          <button
            type="button"
            className="user-icon-button user-remove-button"
            data-user-remove={track.trackKey}
            aria-label={`移除 ${song.title}`}
            title="从歌单移除"
            disabled={disabled}
            onClick={handleAction}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
    </article>
  );
}
