import { useEffect } from 'react';
import type { WorkspacePage } from '../routes.ts';
import type { WorkspaceRefs, WorkspaceScene } from '../types.ts';

export function useArchiveKeyboard({
  page,
  scene,
  playerView,
  library,
  settings,
  user,
  footprint,
  archive,
  inputRef,
  show,
}: Omit<WorkspaceRefs, 'sceneContainer'> & {
  page: WorkspacePage;
  scene: WorkspaceScene | null;
  show: (page: WorkspacePage) => void;
}) {
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || settings.current?.open) return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, [contenteditable="true"], [data-song-search-panel]',
        )
      )
        return;
      if (
        page === 'archive' &&
        scene &&
        scene.entryPhase !== 'ready' &&
        scene.entryPhase !== 'failed'
      ) {
        return;
      }
      if (playerView.current?.expanded) {
        if (event.key === 'Escape') {
          event.preventDefault();
          playerView.current.setExpanded(false, true);
        }
        return;
      }
      if (page !== 'archive') {
        if (
          event.key === 'Escape' &&
          !(page === 'user' && user.current?.hasOpenDialog) &&
          !(page === 'footprint' && footprint.current?.hasOpenDialog)
        ) {
          event.preventDefault();
          show('archive');
        }
        return;
      }
      if (library.current?.mode === 'detail') {
        if (event.key === 'Escape') {
          event.preventDefault();
          library.current.closeDetail();
        }
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        const input = inputRef.current;
        if (input && !input.disabled) input.focus({ preventScroll: true });
        else archive.current?.querySelector<HTMLButtonElement>('[data-nav="search"]')?.click();
        return;
      }
      const arrows = {
        ArrowUp: ['row', -1],
        ArrowDown: ['row', 1],
        ArrowLeft: ['lane', -1],
        ArrowRight: ['lane', 1],
      } as const;
      if (event.key in arrows) {
        event.preventDefault();
        const [axis, direction] = arrows[event.key as keyof typeof arrows];
        library.current?.navigate(axis, direction);
      }
      if (event.key === 'Enter') library.current?.openDetail();
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [page, show, scene, playerView, library, settings, user, footprint, archive, inputRef]);
}
