import { Icon } from '../../shared/react/ui.tsx';
import type { PersonalTrack } from '../../services/music/personal-library.ts';
import type { UserSection } from './types.ts';
import { PlaylistHeader, type PlaylistHeaderProps } from './PlaylistHeader.tsx';
import { UserTrackRow, type UserTrackRowProps } from './UserTrackRow.tsx';

function Pagination({
  index,
  more,
  disabled,
  onStep,
}: {
  index: number;
  more: boolean;
  disabled: boolean;
  onStep(step: number): void;
}) {
  return (
    <nav className="user-pagination" aria-label="个人音乐翻页">
      <button
        type="button"
        data-user-page-step="-1"
        aria-label="上一页"
        disabled={disabled || index === 0}
        onClick={() => onStep(-1)}
      >
        <Icon name="left" />
      </button>
      <span>第 {index + 1} 页</span>
      <button
        type="button"
        data-user-page-step="1"
        aria-label="下一页"
        disabled={disabled || !more}
        onClick={() => onStep(1)}
      >
        <Icon name="right" />
      </button>
    </nav>
  );
}

export function PlaylistDetail({
  section,
  selectedId,
  tracks,
  pageIndex,
  disabled: contentDisabled,
  header,
  onStep,
  onTrackAction,
}: {
  section: UserSection;
  selectedId: number | null;
  tracks: PersonalTrack[];
  pageIndex: number;
  disabled: boolean;
  header?: PlaylistHeaderProps;
  onStep: (step: number) => void;
  onTrackAction: UserTrackRowProps['onAction'];
}) {
  const visibleTracks =
    section === 'favorites' ? tracks.slice(0, 5) : tracks.slice(pageIndex * 5, pageIndex * 5 + 5);
  const more = section === 'favorites' ? tracks.length > 5 : (pageIndex + 1) * 5 < tracks.length;
  const removable = selectedId !== null;
  return (
    <>
      {header && <PlaylistHeader {...header} />}
      <div className="user-track-list">
        {visibleTracks.length === 0 ? (
          <p className="user-data-empty">
            暂无歌曲。可从播放队列添加歌曲到歌单，或点击歌曲旁的心形收藏。
          </p>
        ) : (
          visibleTracks.map((track) => (
            <UserTrackRow
              key={track.trackKey}
              track={track}
              liked={section === 'favorites' || Boolean(track.liked)}
              removable={removable}
              disabled={contentDisabled}
              onAction={onTrackAction}
            />
          ))
        )}
      </div>
      <Pagination index={pageIndex} more={more} disabled={contentDisabled} onStep={onStep} />
    </>
  );
}
