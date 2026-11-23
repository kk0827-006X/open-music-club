import { useCallback, useEffect, useState } from 'react';
import { workspaceParent, type WorkspacePage as Page, type WorkspaceRoute } from '../routes.ts';
import type { SongQuery, WorkspaceProps, WorkspaceRefs } from '../types.ts';

export function useWorkspaceNavigation({
  routedPage,
  onNavigate,
  library,
}: {
  routedPage?: WorkspaceRoute;
  onNavigate?: WorkspaceProps['onNavigate'];
  library: WorkspaceRefs['library'];
}) {
  const [localRoute, setRoute] = useState<WorkspaceRoute>('archive');
  const route = routedPage ?? localRoute;
  const page = workspaceParent(route);
  const [visited, setVisited] = useState<Set<Page>>(
    () => new Set(page === 'archive' ? [] : [page]),
  );
  const [songQuery, setSongQuery] = useState<SongQuery | null>(null);
  const show = useCallback(
    (next: WorkspaceRoute) => {
      setSongQuery(null);
      const parent = workspaceParent(next);
      if (parent !== 'archive') {
        library.current?.resetDetail();
        setVisited((previous) => new Set(previous).add(parent));
      }
      if (onNavigate) onNavigate(next);
      else setRoute(next);
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
  return { page, route, visited, show, songQuery, setSongQuery };
}
