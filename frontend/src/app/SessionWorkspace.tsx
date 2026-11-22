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
  if (!session) return null;
  const { flushLastPlayed, ...workspaceSession } = session;
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <Workspace
          {...workspaceSession}
          page={page}
          onNavigate={onNavigate}
          role={role}
          footprintRevision={footprintRevision}
          onLogout={async () => {
            await flushLastPlayed();
            await onLogout();
          }}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
