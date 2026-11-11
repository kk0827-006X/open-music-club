import { lazy, Suspense } from 'react';
import { ErrorBoundary } from '../shared/react/ErrorBoundary.tsx';
import type { WorkspacePage } from './routes.ts';
import type { Role } from './hooks/use-auth-machine.ts';
import { usePlaybackSession } from './hooks/use-playback-session.ts';

const Workspace = lazy(() => import('./Workspace.tsx'));

export function SessionWorkspace({
  onLogout,
  role,
  page,
  onNavigate,
}: {
  onLogout(): Promise<void>;
  role: Role;
  page: WorkspacePage;
  onNavigate(page: WorkspacePage): void;
}) {
  const { session, footprintRevision } = usePlaybackSession();
  return (
    session && (
      <ErrorBoundary>
        <Suspense fallback={null}>
          <Workspace
            {...session}
            page={page}
            onNavigate={onNavigate}
            role={role}
            footprintRevision={footprintRevision}
            onLogout={onLogout}
          />
        </Suspense>
      </ErrorBoundary>
    )
  );
}
