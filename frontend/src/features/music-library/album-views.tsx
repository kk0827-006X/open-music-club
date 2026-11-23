import { useRef, useState } from 'react';
import { FALLBACK_COVER, type SearchItem } from '../../shared/music.ts';
import { formatDurationSeconds } from '../../shared/format.ts';
import { replaceBrokenCover } from '../../shared/react/image.ts';
import { Icon } from '../../shared/react/ui.tsx';
import type { LibraryAlbum } from './personal-albums.ts';
import { albumTrack } from './tracks.ts';

export type DetailTrackState = 'ready' | 'loading' | 'unavailable';

function durationOf(album: LibraryAlbum) {
  const seconds = album.tracks.reduce((total, track) => {
    const [minutes, remainder] = track.duration.split(':').map(Number);
    return (
      total +
      (Number.isFinite(minutes) ? minutes : 0) * 60 +
      (Number.isFinite(remainder) ? remainder : 0)
    );
  }, 0);
  return formatDurationSeconds(seconds);
}

export function AlbumInformation({
  album,
  index,
  active = true,
  visible = true,
  onOpen = () => undefined,
}: {
  album: LibraryAlbum;
  index: number;
  active?: boolean;
  visible?: boolean;
  onOpen?: () => void;
}) {
  return (
    <aside
      className="archive-selection-copy"
      data-album-information
      hidden={!visible}
      aria-hidden={!visible}
      aria-live="polite"
      inert={active ? undefined : true}
    >
      <p>ALBUM {String(index + 1).padStart(3, '0')}</p>
      <h2>{album.title}</h2>
      <h3>{album.artist}</h3>
      <span>{album.artist}</span>
      <dl>
        <div>
          <dt>RELEASE / 发行年份</dt>
          <dd>{album.year}</dd>
        </div>
        <div>
          <dt>ARTIST / 艺术家</dt>
          <dd>{album.artist}</dd>
        </div>
        <div>
          <dt>GENRE / 流派</dt>
          <dd>{album.genre}</dd>
        </div>
        <div>
          <dt>SOURCE / 来源</dt>
          <dd>
            <b>
              <i />
              {album.personal ? '个人曲库' : 'NETEASE'}
            </b>
          </dd>
        </div>
        <div>
          <dt>TRACKS / 曲目数量</dt>
          <dd>{album.totalTracks} 首</dd>
        </div>
        <div>
          <dt>FORMAT / 播放形式</dt>
          <dd>{album.personal ? '站内与网易云' : '在线音源'}</dd>
        </div>
        <div>
          <dt>PREVIEW / 代表曲目</dt>
          <dd>{durationOf(album)}</dd>
        </div>
        <div>
          <dt>CATALOG / 目录</dt>
          <dd>{album.personal ? '我的音乐' : '网易云音乐'}</dd>
        </div>
      </dl>
      <button type="button" data-open-selected onClick={onOpen}>
        打开专辑{' '}
        <span>
          <Icon name="open" />
        </span>
      </button>
    </aside>
  );
}

export function AlbumDetail({
  album,
  trackState = 'ready',
  onClose = () => undefined,
  onPlay = () => undefined,
  onEnqueue = () => undefined,
  onPlayAll,
}: {
  album: LibraryAlbum;
  trackState?: DetailTrackState;
  onClose?: () => void;
  onPlay?: (id: string) => void;
  onEnqueue?: (id: string) => void;
  onPlayAll?: (tracks: SearchItem[]) => Promise<void>;
}) {
  const [playingAll, setPlayingAll] = useState(false);
  const playingRef = useRef(false);
  const [playError, setPlayError] = useState('');
  const playable = album.tracks.filter((track) => !('playable' in track) || track.playable);
  const playAll = async () => {
    if (trackState !== 'ready' || !playable.length || !onPlayAll || playingRef.current) return;
    playingRef.current = true;
    setPlayingAll(true);
    setPlayError('');
    try {
      await onPlayAll(
        album.tracks.flatMap((track, index) =>
          'playable' in track && !track.playable ? [] : [albumTrack(album, index)],
        ),
      );
    } catch {
      setPlayError('专辑播放失败，请重试。');
    } finally {
      playingRef.current = false;
      setPlayingAll(false);
    }
  };
  const trackHeading =
    trackState === 'loading'
      ? '正在获取专辑全部曲目…'
      : trackState === 'unavailable'
        ? album.personal
          ? '曲目暂时无法加载'
          : '完整曲目暂时不可用 · 以下为代表曲目'
        : '专辑曲目';
  return (
    <>
      {' '}
      <button className="detail-back" type="button" data-back-to-archive onClick={onClose}>
        <Icon name="left" />
        &nbsp;&nbsp;返回专辑架 <kbd>ESC</kbd>
      </button>
      <section className="detail-cover-frame">
        <div className="detail-cover">
          <img
            src={album.coverUrl ?? FALLBACK_COVER}
            alt={`${album.title} 封面`}
            onError={replaceBrokenCover}
          />
        </div>
        <p>ALBUM / {album.id}</p>
        <small>{album.personal ? '个人曲库' : '网易云音乐 · 真实专辑封面'}</small>
      </section>
      <article className="detail-information" data-detail-information>
        <p>ALBUM DETAIL&nbsp;&nbsp;/&nbsp;&nbsp;MUSIC ARCHIVE</p>
        <h2>{album.title}</h2>
        <h3>{album.artist}</h3>
        <div className="detail-facts">
          <p>
            <small>RELEASE / 发行年份</small>
            {album.year}
          </p>
          <p>
            <small>ARTIST / 艺术家</small>
            {album.artist}
          </p>
          <p>
            <small>GENRE / 流派</small>
            {album.genre}
          </p>
          <p>
            <small>SOURCE / 来源</small>
            {album.personal ? '个人曲库' : 'NETEASE'}
          </p>
        </div>
        <p className="detail-description">{album.description}</p>
        <section className="detail-track-preview" aria-live="polite">
          <header>
            <b>01&nbsp;&nbsp;{trackHeading}</b>
            <div className="detail-album-actions">
              <span>专辑共 {album.totalTracks} 首</span>
              <button
                type="button"
                data-album-play-all
                disabled={trackState !== 'ready' || !playable.length || !onPlayAll || playingAll}
                onClick={() => {
                  void playAll();
                }}
                aria-busy={playingAll}
              >
                <Icon name="play" />
                播放全部
              </button>
            </div>
          </header>
          {playError && <p role="status">{playError}</p>}
          {album.personal && trackState === 'ready' && !album.tracks.length && <p>暂无歌曲</p>}
          <ol>
            {trackState !== 'loading' &&
              album.tracks.map((track, index) => (
                <li key={`${track.id}-${index}`}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{track.title}</strong>
                  <small>
                    {'song' in track && track.song.source === 'local' ? 'LOCAL' : 'NETEASE'}
                  </small>
                  <time>{track.duration}</time>
                  <button
                    type="button"
                    data-album-play={track.id}
                    disabled={'playable' in track && !track.playable}
                    onClick={() => onPlay(track.id)}
                  >
                    <Icon name="play" /> 播放
                  </button>
                  <button
                    type="button"
                    data-album-queue={track.id}
                    disabled={'playable' in track && !track.playable}
                    onClick={() => onEnqueue(track.id)}
                  >
                    <Icon name="plus" /> 队列
                  </button>
                </li>
              ))}
          </ol>
        </section>
      </article>
    </>
  );
}
