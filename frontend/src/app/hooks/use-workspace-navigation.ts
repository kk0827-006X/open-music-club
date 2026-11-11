import { useCallback, useEffect, useState } from 'react';
import type { WorkspacePage as Page } from '../routes.ts';
import type { SongQuery, WorkspaceProps, WorkspaceRefs } from '../types.ts';

export function useWorkspaceNavigation({
  routedPage,
  onNavigate,
  library,
}: {
  routedPage?: Page;
  onNavigate?: WorkspaceProps['onNavigate'];
  library: WorkspaceRefs['library'];
}) {
  const [localPage, setPage] = useState<Page>('archive');
  const page = routedPage ?? localPage;
  const [visited, setVisited] = useState<Set<Page>>(
    () => new Set(page === 'archive' ? [] : [page]),
  );
  const [songQuery, setSongQuery] = useState<SongQuery | null>(null);
  const show = useCallback(
    (next: Page) => {
      setSongQuery(null);
      if (next !== 'archive') {
        library.current?.resetDetail();
        setVisited((previous) => new Set(previous).add(next));
      }
      if (onNavigate) onNavigate(next);
      else setPage(next);
    },
    [onNavigate, library],
  );
  useEffect(() => {
    setSongQuery(null);
    if (page !== 'archive') {
      library.current?.resetDetail();
      setVisited((previous) => (previous.has(page) ? previous : new Set(previous).add(page)));
    }
  }, [page, library]);
  return { page, visited, show, songQuery, setSongQuery };
}
