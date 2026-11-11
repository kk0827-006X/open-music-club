import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { usePageMotion } from '../../shared/react/page-transitions.ts';
import { CollapsibleSidebarLayout } from '../../shared/react/CollapsibleSidebarLayout.tsx';
import {
  createPersonalLibraryClient,
  toPersonalSong,
  type PersonalTrack,
} from '../../services/music/personal-library.ts';
import type { SearchItem } from '../../services/music/search.ts';
import { AdminApplicationsPage } from '../auth/AdminApplicationsPage.tsx';
import { PlaylistCardDeck } from './PlaylistCardDeck.tsx';
import { UserSidebar } from './UserSidebar.tsx';
import { PlaylistDetail } from './PlaylistDetail.tsx';
import { CreatePlaylistDialog } from './CreatePlaylistDialog.tsx';
import { DeletePlaylistDialog } from './DeletePlaylistDialog.tsx';
import { headings } from './types.ts';
import { useProfile } from './hooks/use-profile.ts';
import { usePersonalLibraryData, playPlaylistTracks } from './hooks/use-personal-library-data.ts';
import { usePlaylistMutations } from './hooks/use-playlist-mutations.ts';

export interface UserPageProps {
  active: boolean;
  role?: 'admin' | 'user';
  play?: (song: SearchItem) => Promise<unknown>;
  enqueue?: (song: SearchItem) => void;
  choosePlaylist?: (song: SearchItem) => void;
  changed?: () => void;
  client?: ReturnType<typeof createPersonalLibraryClient>;
}

export interface UserPageHandle {
  refresh(): Promise<unknown>;
  readonly hasOpenDialog: boolean;
}

export const UserPage = forwardRef<UserPageHandle, UserPageProps>(function UserPage(
  { active, role = 'user', play, enqueue, changed, client },
  ref,
) {
  const pageMotion = usePageMotion(active);
  const api = useMemo(() => client || createPersonalLibraryClient(), [client]);
  const pageRef = useRef<HTMLElement>(null);
  const unmountedRef = useRef(false);
  // 在业务 hook 的 effect 之前恢复挂载标记，兼容 StrictMode 重挂载。
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);
  const profile = useProfile(api, unmountedRef);
  const data = usePersonalLibraryData({ api, profile, unmountedRef, active, changed });
  const mutations = usePlaylistMutations({ api, data, unmountedRef, pageRef, changed });
  const { section, selectedId, pageIndex, lists, tracks, busy, loading, changing, feedback } = data;
  const openDialogRef = useRef(false);
  const adminDialogRef = useRef(false);
  const adminDialogChanged = useCallback((open: boolean) => {
    adminDialogRef.current = open;
  }, []);
  openDialogRef.current = mutations.hasOpenDialog;
  useImperativeHandle(
    ref,
    () => ({
      refresh: () => data.refreshRef.current(),
      get hasOpenDialog() {
        return openDialogRef.current || adminDialogRef.current;
      },
    }),
    [],
  );
  const contentDisabled = busy || loading;
  const selectedList =
    selectedId !== null ? lists.find((list) => list.id === selectedId) : undefined;

  const [playlistPlaying, setPlaylistPlaying] = useState(false);
  const { busyRef, loadingRef, tracksRef, playRequestRef, notice, mutate } = data;
  async function playWholePlaylist() {
    if (playlistPlaying || busyRef.current || loadingRef.current) return;
    const serial = ++playRequestRef.current;
    setPlaylistPlaying(true);
    try {
      const count = await playPlaylistTracks(tracksRef.current, { play, enqueue });
      if (unmountedRef.current || serial !== playRequestRef.current) return;
      notice(count ? `歌单中 ${count} 首歌曲已加入队列并开始播放` : '歌单暂无可播放歌曲');
    } catch {
      if (!unmountedRef.current && serial === playRequestRef.current)
        notice('歌曲暂时无法播放，请稍后重试', true);
    } finally {
      if (!unmountedRef.current) setPlaylistPlaying(false);
    }
  }

  function onTrackAction(action: HTMLButtonElement, track: PersonalTrack) {
    if (action.disabled || busyRef.current || loadingRef.current) return;
    const serial = ++playRequestRef.current;
    const song = toPersonalSong(track);
    if (action.hasAttribute('data-user-play')) {
      void play?.(song).catch(() => {
        if (!unmountedRef.current && serial === playRequestRef.current)
          notice('歌曲暂时无法播放，请稍后重试', true);
      });
    } else if (action.hasAttribute('data-user-enqueue')) {
      enqueue?.(song);
      notice('已加入播放队列');
    } else if (action.hasAttribute('data-user-like')) {
      const liked = section === 'favorites' || Boolean(track.liked);
      void mutate(() => api.setLiked(track, !liked), liked ? '已取消喜爱' : '已保存到喜爱');
    } else if (selectedId !== null) {
      const playlistId = selectedId;
      void mutate(() => api.removeTrack(playlistId, track), '已从歌单移除');
    }
  }

  let contentBody: ReactNode;
  if (section === 'admin') {
    contentBody =
      active && role === 'admin' ? (
        <AdminApplicationsPage embedded onDialogChange={adminDialogChanged} />
      ) : null;
  } else if (section === 'playlists' && selectedId === null) {
    contentBody = (
      <>
        <div className="user-collection-intro">
          <strong>
            {lists.length} <small>份声音档案</small>
          </strong>
        </div>
        <PlaylistCardDeck
          lists={lists}
          disabled={contentDisabled}
          onOpen={data.openPlaylist}
          onCreate={mutations.openCreateDialog}
        />
      </>
    );
  } else if (section === 'recent') {
    contentBody = (
      <div className="user-empty-state">
        <span className="user-empty-symbol">↺</span>
        <h3>播放记录尚未开启</h3>
        <p>历史记录功能将单独接入，不使用临时队列冒充记录。</p>
      </div>
    );
  } else {
    contentBody = (
      <PlaylistDetail
        section={section}
        selectedId={selectedId}
        tracks={tracks}
        pageIndex={pageIndex}
        disabled={contentDisabled}
        onStep={data.onStep}
        onTrackAction={onTrackAction}
        header={
          selectedList
            ? {
                list: selectedList,
                playable: !playlistPlaying && tracks.some((track) => track.playable),
                disabled: contentDisabled,
                onBack: data.backToPlaylists,
                onPlay: () => void playWholePlaylist(),
                ...mutations.headerProps(selectedList),
              }
            : undefined
        }
      />
    );
  }

  return (
    <motion.section
      ref={pageRef}
      className="user-page"
      data-user-page
      {...pageMotion}
      aria-label="个人音乐空间"
    >
      <CollapsibleSidebarLayout
        active={active}
        variant="user"
        sidebarClassName="user-sidebar"
        sidebar={(expanded) => (
          <UserSidebar
            active={active}
            expanded={expanded}
            role={role}
            section={section}
            profile={profile}
            onSectionChange={data.changeSection}
          />
        )}
      >
        <div className="user-content-shell">
          <header className="user-content-header">
            <h2 className="sr-only" data-user-heading>
              {headings[section]}
            </h2>
          </header>
          <div
            className={`user-content section-content${changing ? ' is-changing' : ''}`}
            data-user-content
            inert={changing}
            aria-live="polite"
            aria-busy={busy || loading || changing}
          >
            {contentBody}
          </div>
          <p
            className="user-preview-note"
            data-user-feedback
            role="status"
            data-error={String(feedback.error)}
          >
            {section === 'admin' ? '' : feedback.message}
          </p>
        </div>
      </CollapsibleSidebarLayout>

      <CreatePlaylistDialog {...mutations.create} busy={busy} />
      <DeletePlaylistDialog {...mutations.deletion} busy={busy} loading={loading} />
    </motion.section>
  );
});

export default UserPage;
