import { lazy, Suspense, useCallback } from 'react';
import { SongSearchPanel } from '../features/search/SongSearchPanel';
import { GooeySearch } from '../shared/react/aceternity/GooeySearch';
import { LibraryView } from '../features/music-library/LibraryView.tsx';
import type { DemoAlbum } from '../features/music-library/album-data.ts';
import { albumTrack } from '../features/music-library/tracks.ts';
import { PlayerView } from '../features/player/PlayerView.tsx';
import { SettingsDialog } from '../features/settings/SettingsDialog.tsx';
import { Brand, Icon } from '../shared/react/ui.tsx';
import { ErrorBoundary } from '../shared/react/ErrorBoundary.tsx';
import type { PlayerCommands, WorkspaceProps, WorkspaceRefs } from './types.ts';
import type { useWorkspaceNavigation } from './hooks/use-workspace-navigation.ts';
import type { useWorkspaceScene } from './hooks/use-workspace-scene.ts';

const UploadPage = lazy(() => import('../features/upload/UploadPage.tsx'));
const UserPage = lazy(() => import('../features/user/UserPage.tsx'));
const FootprintPage = lazy(() => import('../features/footprint/FootprintPage.tsx'));
const tabs = [
  ['library', '音乐库', 'library'],
  ['search', '搜索', 'search'],
  ['upload', '上传音乐', 'upload'],
  ['footprint', '音乐足迹', 'route'],
  ['user', '用户', 'user'],
] as const;

interface WorkspaceViewProps {
  workspace: WorkspaceProps;
  refs: WorkspaceRefs;
  navigation: ReturnType<typeof useWorkspaceNavigation>;
  archiveScene: ReturnType<typeof useWorkspaceScene>;
  playerCommands: PlayerCommands;
  client: NonNullable<WorkspaceProps['personalLibrary']>;
  footprints: NonNullable<WorkspaceProps['footprintClient']>;
  selected: DemoAlbum;
  onSelected: (album: DemoAlbum) => void;
  expanded: boolean;
  onExpandedChanged: (open: boolean) => void;
  onSettingsOpenChanged: (open: boolean) => void;
}

export function WorkspaceView({
  workspace,
  refs,
  navigation,
  archiveScene,
  playerCommands,
  client,
  footprints,
  selected,
  onSelected,
  expanded,
  onExpandedChanged,
  onSettingsOpenChanged,
}: WorkspaceViewProps) {
  const {
    role = 'user',
    player,
    queue,
    footprintRevision = 0,
    onLogout,
    initialIndex = 0,
  } = workspace;
  const { archive, sceneContainer, library, playerView, settings, user, footprint, inputRef } =
    refs;
  const { page, visited, show, songQuery, setSongQuery } = navigation;
  const { scene, entryPhase, pageEntryPhase, entering, playbackMotion, changePlaybackMotion } =
    archiveScene;
  const collectionChanged = useCallback(() => {
    if (page === 'user') void user.current?.refresh();
  }, [page, user]);
  return (
    <main
      ref={archive}
      className="album-archive"
      data-album-archive
      data-view={page}
      data-entry-phase={pageEntryPhase}
      data-layout={entering ? 'opening' : undefined}
      onErrorCapture={(event) => {
        const image = event.target;
        if (
          image instanceof HTMLImageElement &&
          !image.src.endsWith('/images/album-placeholder-01.svg')
        )
          image.src = '/images/album-placeholder-01.svg';
      }}
    >
      <Brand statistics />
      {entering && (
        <div className="archive-entry-overlay" data-archive-entry>
          <span className="sr-only" role="status">
            {entryPhase === 'loading' ? '正在加载音乐档案' : '正在进入音乐档案'}
          </span>
        </div>
      )}
      <nav
        className="archive-nav"
        data-archive-navigation
        inert={entering ? true : undefined}
        aria-label="音乐功能预览"
      >
        {tabs.map(([id, label, icon]) =>
          id === 'search' ? (
            <GooeySearch
              key={id}
              inputRef={inputRef}
              onSearch={(term) => {
                playerCommands.closeQueue();
                setSongQuery((previous) => ({ term, serial: (previous?.serial ?? 0) + 1 }));
              }}
            />
          ) : (
            <button
              key={id}
              type="button"
              data-nav={id}
              aria-current={page === (id === 'library' ? 'archive' : id) ? 'page' : undefined}
              onClick={() => show(id === 'library' ? 'archive' : id)}
            >
              <Icon name={icon} />
              <span>{label}</span>
            </button>
          ),
        )}
        <i aria-hidden="true" />
        <button
          type="button"
          data-nav="settings"
          onClick={(event) => {
            playerCommands.closeQueue();
            settings.current?.show(event.currentTarget);
          }}
        >
          <Icon name="settings" />
          <span>设置</span>
        </button>
      </nav>
      <section
        className="album-wave-stage"
        data-wave-field
        aria-label="三维专辑档案选择"
        inert={page !== 'archive' || entering}
      >
        <div ref={sceneContainer} className="archive-three-scene" data-three-scene />
      </section>
      <LibraryView
        ref={library}
        scene={scene}
        actions={playerCommands}
        onPlayAlbum={playerCommands.replaceAndPlay}
        onSelected={onSelected}
        onModeChanged={() => undefined}
        active={page === 'archive' && !entering}
        initialIndex={initialIndex}
      />
      <ErrorBoundary>
        <Suspense fallback={null}>
          <div
            data-upload-host
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest('[data-upload-back]'))
                show('archive');
            }}
          >
            {visited.has('upload') && <UploadPage active={page === 'upload'} />}
          </div>
          <div data-user-host>
            {visited.has('user') && (
              <UserPage
                ref={user}
                active={page === 'user'}
                role={role}
                play={playerCommands.play}
                enqueue={playerCommands.enqueue}
                client={client}
                choosePlaylist={(track) => {
                  void playerCommands.choosePlaylist(track);
                }}
                changed={() => {
                  void playerCommands.syncLiked();
                }}
              />
            )}
          </div>
          <div data-footprint-host>
            {visited.has('footprint') && (
              <FootprintPage
                ref={footprint}
                active={page === 'footprint'}
                play={playerCommands.play}
                enqueue={playerCommands.enqueue}
                client={footprints}
                revision={footprintRevision}
              />
            )}
          </div>
        </Suspense>
      </ErrorBoundary>
      <div className="archive-player-layer" inert={entering ? true : undefined}>
        <PlayerView
          ref={playerView}
          player={player}
          queue={queue}
          personalLibrary={client}
          root={archive}
          selectedAlbum={selected}
          defaultTrack={albumTrack(selected)}
          onExpandedChanged={onExpandedChanged}
          collectionChanged={collectionChanged}
        />
      </div>
      {songQuery && (
        <div hidden={expanded} inert={expanded ? true : undefined}>
          <SongSearchPanel
            query={songQuery}
            onClose={() => setSongQuery(null)}
            onFocusToggle={() => {
              const input = inputRef.current;
              if (input && !input.disabled) input.focus({ preventScroll: true });
              else
                archive.current
                  ?.querySelector<HTMLButtonElement>('[data-nav="search"]')
                  ?.focus({ preventScroll: true });
            }}
            onPlay={playerCommands.play}
            onSave={(track) => {
              void playerCommands.choosePlaylist(track);
            }}
          />
        </div>
      )}
      <SettingsDialog
        role={role}
        playbackMotion={playbackMotion}
        onPlaybackMotionChange={changePlaybackMotion}
        ref={settings}
        logout={onLogout}
        onOpen={() => onSettingsOpenChanged(true)}
        onClose={() => onSettingsOpenChanged(false)}
      />
    </main>
  );
}
