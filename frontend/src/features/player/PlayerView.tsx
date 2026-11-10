import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { RefObject } from 'react';
import type { createPersonalLibraryClient } from '../../services/music/personal-library.ts';
import type { SearchItem } from '../../shared/music.ts';
import { Icon, Modal } from '../../shared/react/ui.tsx';
import { useReducedMotion } from '../../shared/react/hooks.ts';
import type { PlayerController } from './player-core.ts';
import type { PlayerPreview, PlayerDisplay, PlayerDisplayActions } from './types.ts';
import type { MusicQueue } from '../queue/model.ts';
import { createQueuePersistence } from '../queue/persistence.ts';
import { QueueAddFlights, type QueueAddFlightsHandle } from '../queue/QueueAddFlights.tsx';
import { QueuePanel } from '../queue/QueuePanel.tsx';
import { usePlayerCollection } from './hooks/usePlayerCollection.ts';
import { usePlayerVisibility } from './hooks/usePlayerVisibility.ts';
import { usePlayerQueue } from './hooks/usePlayerQueue.ts';
import { usePlayerLikes } from './hooks/usePlayerLikes.ts';
import { usePlayerLyrics } from './hooks/usePlayerLyrics.ts';
import { CompactPlayer } from './CompactPlayer.tsx';
import { ExpandedPlayer } from './ExpandedPlayer.tsx';

// 只有上层应用会话创建 Audio；本视图只通过 PlayerController 读取与修改播放状态。
export interface PlayerViewProps {
  player: PlayerController;
  queue: MusicQueue;
  personalLibrary: ReturnType<typeof createPersonalLibraryClient>;
  selectedAlbum: PlayerPreview;
  defaultTrack: SearchItem;
  onExpandedChanged(open: boolean): void;
  collectionChanged(): void;
  root: RefObject<HTMLElement | null>;
}

export interface PlayerViewHandle {
  play(track: SearchItem): Promise<void>;
  replaceAndPlay(tracks: readonly SearchItem[]): Promise<void>;
  enqueue(track: SearchItem): void;
  choosePlaylist(track: SearchItem): Promise<void>;
  syncLiked(): Promise<void>;
  closeQueue(): void;
  setExpanded(open: boolean, restoreFocus?: boolean): void;
  readonly expanded: boolean;
}

export const PlayerView = forwardRef<PlayerViewHandle, PlayerViewProps>(
  function PlayerView(props, ref) {
    const { player, queue, personalLibrary, selectedAlbum, defaultTrack, root } = props;
    const reduced = Boolean(useReducedMotion());
    const subscribe = useCallback(
      (onStoreChange: () => void) => player.subscribe(() => onStoreChange()),
      [player],
    );
    const state = useSyncExternalStore(subscribe, player.get, player.get);
    const activeTrack = state.track;

    const stateRef = useRef(state);
    stateRef.current = state;
    const defaultTrackRef = useRef(defaultTrack);
    defaultTrackRef.current = defaultTrack;
    const personalLibraryRef = useRef(personalLibrary);
    personalLibraryRef.current = personalLibrary;
    const onExpandedChangedRef = useRef(props.onExpandedChanged);
    onExpandedChangedRef.current = props.onExpandedChanged;
    const collectionChangedRef = useRef(props.collectionChanged);
    collectionChangedRef.current = props.collectionChanged;
    const disposedRef = useRef(false);
    // 首次挂载只读现有歌曲；切歌时才联动队列、收藏和歌词，timeupdate 不重复触发。
    const firstTrackRef = useRef(true);
    const lastTrackRef = useRef<SearchItem | null>(null);
    useEffect(() => {
      disposedRef.current = false;
      firstTrackRef.current = true;
      lastTrackRef.current = null;
      return () => {
        disposedRef.current = true;
      };
    }, []);
    const animationRef = useRef<QueueAddFlightsHandle | null>(null);
    const onAdded = useCallback(() => animationRef.current?.added(), []);
    const collection = usePlayerCollection({ personalLibrary, disposedRef, collectionChangedRef });
    const visibility = usePlayerVisibility({ animationRef, onExpandedChangedRef });
    const { queueOpen, expanded, playerVisible } = visibility;
    const queueActions = usePlayerQueue({
      queue,
      player,
      stateRef,
      defaultTrackRef,
      personalLibraryRef,
      disposedRef,
      collectionNotice: collection.collectionNotice,
      setQueueOpen: visibility.setQueueOpen,
      onAdded,
      createPersistence: createQueuePersistence,
    });
    const likes = usePlayerLikes({
      personalLibrary,
      queue,
      stateRef,
      collectionChangedRef,
      disposedRef,
      collectionNotice: collection.collectionNotice,
      queueOpen,
      queryVersion: queueActions.queueVersion,
    });
    const { liked, likePending, pendingLikes } = likes;
    const lyrics = usePlayerLyrics({
      disposedRef,
      expanded,
      currentTime: state.currentTime,
      reduced,
    });
    const { lyricLines, lyricMessage } = lyrics;
    useEffect(() => {
      const track = state.track;
      if (firstTrackRef.current) {
        firstTrackRef.current = false;
        lastTrackRef.current = track;
        if (track) {
          lyrics.requestLyrics(track);
          void likes.syncLikedFor(track);
        }
        return;
      }
      if (track === lastTrackRef.current) return;
      lastTrackRef.current = track;
      if (!track) {
        likes.clearLiked();
        lyrics.clearLyrics();
        return;
      }
      void likes.syncLikedFor(track);
      queueActions.enqueueTrack(track);
      lyrics.requestLyrics(track);
    }, [state.track]);
    useImperativeHandle(
      ref,
      () => ({
        play: queueActions.play,
        replaceAndPlay: queueActions.replaceAndPlay,
        enqueue: queueActions.enqueueTrack,
        choosePlaylist: collection.choosePlaylist,
        syncLiked: () => likes.syncLikedFor(stateRef.current.track),
        closeQueue: visibility.closeQueue,
        setExpanded: visibility.setExpanded,
        get expanded() {
          return visibility.expandedRef.current;
        },
      }),
      [
        collection.choosePlaylist,
        queueActions.enqueueTrack,
        queueActions.play,
        queueActions.replaceAndPlay,
        visibility.setExpanded,
        visibility.closeQueue,
        likes.syncLikedFor,
      ],
    );
    const display: PlayerDisplay = {
      state,
      expanded,
      playerVisible,
      queueOpen,
      liked,
      playerLikeDisabled:
        !activeTrack || likePending || (activeTrack ? pendingLikes.has(activeTrack.key) : false),
      previousDisabled: !activeTrack || !queue.previous(activeTrack.key),
      nextDisabled: !activeTrack || !queue.next(activeTrack.key),
      volumeValue: Number.isFinite(state.volume) ? Math.min(1, Math.max(0, state.volume)) : 0,
      queueCount: String(queue.items.length).padStart(2, '0'),
    };
    const actions: PlayerDisplayActions = {
      onFooterClick: visibility.onFooterClick,
      setExpanded: visibility.setExpanded,
      onPlayerLike: likes.onPlayerLike,
      playPrevious: queueActions.playPrevious,
      playNext: queueActions.playNext,
      togglePlayback: queueActions.togglePlayback,
      seekToPointer: queueActions.seekToPointer,
      seek: player.seek,
      changeVolume: queueActions.changeVolume,
      onPlayerQueueToggle: visibility.onPlayerQueueToggle,
    };

    return (
      <>
        <QueueAddFlights
          ref={animationRef}
          root={root}
          reduced={reduced}
          reveal={visibility.revealForFlight}
          finish={visibility.schedulePlayerHide}
        />
        <div className="player-hotspot" data-player-hotspot aria-hidden="true" />

        <ExpandedPlayer
          display={display}
          actions={actions}
          lyricLines={lyricLines}
          lyricMessage={lyricMessage}
          refs={{
            expandedSectionRef: visibility.expandedSectionRef,
            closeButtonRef: visibility.closeButtonRef,
            expandedQueueToggleRef: visibility.expandedQueueToggleRef,
            lyricScrollRef: lyrics.lyricScrollRef,
          }}
        />
        <CompactPlayer
          selectedAlbum={selectedAlbum}
          display={display}
          actions={actions}
          refs={{
            footerRef: visibility.footerRef,
            compactOpenButtonRef: visibility.compactOpenButtonRef,
            queueToggleRef: visibility.queueToggleRef,
            openButtonRef: visibility.openButtonRef,
          }}
        />
        <QueuePanel
          ref={visibility.queuePanelRef}
          open={queueOpen}
          immersive={expanded}
          items={queueActions.queueSnapshot}
          activeKey={activeTrack?.key}
          reduced={reduced}
          likes={likes.queueLikes}
          pendingLikes={pendingLikes}
          orderStatus={queueActions.queueOrderStatus}
          onClose={visibility.closeQueue}
          onFocusToggle={visibility.focusQueueToggle}
          onClear={queueActions.clearQueue}
          onPlay={queueActions.playQueueItem}
          onRemove={queueActions.removeQueueTrack}
          onSave={collection.openQueueItemSave}
          onLike={likes.onQueueItemLike}
          onReorder={queueActions.handleReorder}
        />
        <p
          className="collection-feedback"
          data-collection-feedback
          role="status"
          hidden={!collection.notice}
        >
          {collection.notice}
        </p>
        <Modal
          open={collection.collectionOpen}
          onClose={collection.closeCollection}
          busy={collection.collectionBusy}
          className="user-create-dialog"
          data-collection-dialog
          aria-label="将歌曲加入歌单"
        >
          <form data-collection-form onSubmit={collection.submitCollection}>
            <header>
              <span>ADD TO PLAYLIST / 加入歌单</span>
              <button
                type="button"
                data-collection-close
                aria-label="关闭歌单选择"
                onClick={collection.closeCollection}
              >
                <Icon name="close" />
              </button>
            </header>
            <h2>加入歌单</h2>
            <p data-collection-message role="status">
              {collection.collectionMessage}
            </p>
            <label htmlFor="collection-playlist">选择自己的歌单</label>
            <select
              id="collection-playlist"
              name="playlist"
              required
              value={collection.playlistId}
              onChange={(event) => collection.setPlaylistId(event.target.value)}
            >
              {collection.playlists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
            <div className="user-dialog-actions">
              <button type="button" data-collection-close onClick={collection.closeCollection}>
                取消
              </button>
              <button
                type="submit"
                disabled={collection.collectionBusy || collection.playlists.length === 0}
              >
                保存到歌单 <Icon name="right" />
              </button>
            </div>
          </form>
        </Modal>
      </>
    );
  },
);

export default PlayerView;
