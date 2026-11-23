import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
} from 'react';
import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { usePageMotion } from '../../shared/react/page-transitions.ts';
import { CollapsibleSidebarLayout } from '../../shared/react/CollapsibleSidebarLayout.tsx';
import { useLatest } from '../../shared/react/hooks.ts';
import { Icon } from '../../shared/react/ui.tsx';
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
import { FriendsPanel } from './FriendsPanel.tsx';
import { headings, type UserSection } from './types.ts';
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
  renderAvatar?: (active: boolean, onDialogChange: (open: boolean) => void) => ReactNode;
  uploadView?: 'list' | 'form';
  onUploadViewChange?: (view: 'list' | 'form' | null) => void;
  renderUpload?: (props: { active: boolean; onBack(): void; onUploaded(): void }) => ReactNode;
}

export interface UserPageHandle {
  refresh(): Promise<unknown>;
  readonly hasOpenDialog: boolean;
}

export const UserPage = forwardRef<UserPageHandle, UserPageProps>(function UserPage(
  {
    active,
    role = 'user',
    play,
    enqueue,
    changed,
    client,
    renderAvatar,
    uploadView,
    onUploadViewChange,
    renderUpload,
  },
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
  const data = usePersonalLibraryData({
    api,
    profile,
    unmountedRef,
    active,
    changed,
    initialSection: uploadView ? 'uploads' : 'playlists',
  });
  const mutations = usePlaylistMutations({ api, data, unmountedRef, pageRef, changed });
  const { section, selectedId, pageIndex, lists, tracks, busy, loading, changing, feedback } = data;
  const uploadOpen = section === 'uploads' && uploadView === 'form';
  const [uploadVisited, setUploadVisited] = useState(uploadOpen);
  const uploadEntryRef = useRef<HTMLButtonElement>(null);
  const uploadWasOpen = useRef(uploadOpen);
  const changeSectionRef = useLatest(data.changeSection);
  useEffect(() => {
    if (active && uploadView && section !== 'uploads' && !changing)
      changeSectionRef.current('uploads');
  }, [active, uploadView, section, changing, changeSectionRef]);
  useLayoutEffect(() => {
    if (uploadOpen) setUploadVisited(true);
    else if (uploadWasOpen.current && active && section === 'uploads' && !changing)
      uploadEntryRef.current?.focus({ preventScroll: true });
    uploadWasOpen.current = uploadOpen;
  }, [active, uploadOpen, section, changing]);

  function changeSection(next: UserSection) {
    if (next === 'uploads' && onUploadViewChange) {
      if (uploadView !== 'list') onUploadViewChange('list');
      return;
    }
    if (uploadView) onUploadViewChange?.(null);
    data.changeSection(next);
  }
  const openDialogRef = useRef(false);
  const adminDialogRef = useRef(false);
  const avatarDialogRef = useRef(false);
  const friendDialogRef = useRef(false);
  const avatarDialogChanged = useCallback((open: boolean) => {
    avatarDialogRef.current = open;
  }, []);
  const adminDialogChanged = useCallback((open: boolean) => {
    adminDialogRef.current = open;
  }, []);
  const friendDialogChanged = useCallback((open: boolean) => {
    friendDialogRef.current = open;
  }, []);
  openDialogRef.current = mutations.hasOpenDialog;
  useImperativeHandle(
    ref,
    () => ({
      refresh: () => data.refreshRef.current(),
      get hasOpenDialog() {
        return (
          openDialogRef.current ||
          adminDialogRef.current ||
          avatarDialogRef.current ||
          friendDialogRef.current
        );
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
  if (section === 'avatar') {
    contentBody = (
      <Suspense fallback={<p role="status">正在打开像素工坊…</p>}>
        {renderAvatar?.(active, avatarDialogChanged)}
      </Suspense>
    );
  } else if (section === 'friends') {
    contentBody = <FriendsPanel active={active} onDialogChange={friendDialogChanged} />;
  } else if (section === 'admin') {
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
            onSectionChange={changeSection}
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
            aria-busy={!uploadOpen && (busy || loading || changing)}
          >
            {section === 'uploads' && !uploadOpen && onUploadViewChange && (
              <div className="user-uploads-toolbar">
                <button
                  className="user-back"
                  type="button"
                  data-user-open-upload
                  ref={uploadEntryRef}
                  onClick={() => onUploadViewChange('form')}
                >
                  <Icon name="plus" /> 上传音乐
                </button>
              </div>
            )}
            {!uploadOpen && contentBody}
            {(uploadVisited || uploadOpen) && (
              <Suspense fallback={uploadOpen ? <p role="status">正在打开上传表单…</p> : null}>
                {renderUpload?.({
                  active: active && uploadOpen && !changing,
                  onBack: () => onUploadViewChange?.('list'),
                  onUploaded: () => {
                    if (section === 'uploads') void data.refreshRef.current();
                  },
                })}
              </Suspense>
            )}
          </div>
          <p
            className="user-preview-note"
            data-user-feedback
            role="status"
            data-error={String(feedback.error)}
          >
            {uploadOpen || section === 'admin' || section === 'avatar' || section === 'friends'
              ? ''
              : feedback.message}
          </p>
        </div>
      </CollapsibleSidebarLayout>

      <CreatePlaylistDialog {...mutations.create} busy={busy} />
      <DeletePlaylistDialog {...mutations.deletion} busy={busy} loading={loading} />
    </motion.section>
  );
});

export default UserPage;
