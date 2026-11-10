import { ResetPasswordPage } from '../features/auth/ResetPasswordPage.tsx';
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router';
import {
  adminPath,
  loginDestination,
  workspacePage,
  workspacePaths,
  type WorkspacePage,
} from './routes.ts';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  loginAndVerify,
  logoutSession,
  restoreSession,
  type LoginCredentials,
} from '../services/auth/session.ts';
import { EntryPage } from '../features/auth/EntryPage.tsx';
import { LoginPage } from '../features/auth/LoginPage.tsx';
import { AuthorizedSequence } from '../features/auth/AuthorizedSequence.tsx';
import { MusicQueue } from '../features/queue/model.ts';
import { createPlayerController, type PlayerController } from '../features/player/player-core.ts';
import { resolvePlaybackUrl } from '../services/music/search.ts';
import { ErrorBoundary } from '../shared/react/ErrorBoundary.tsx';
import { createFootprintClient, durationToMs } from '../services/music/footprint.ts';
import { ApplicationLinkPage } from '../features/auth/ApplicationLinkPage.tsx';
import { AdminApplicationsPage } from '../features/auth/AdminApplicationsPage.tsx';

const Workspace = lazy(() => import('./Workspace.tsx'));
type Role = 'admin' | 'user';
type Stage = 'entry' | 'restoring' | 'login' | 'authorized' | 'workspace';

export interface AppServices {
  restore: typeof restoreSession;
  login: typeof loginAndVerify;
  logout: typeof logoutSession;
}
const services: AppServices = {
  restore: restoreSession,
  login: loginAndVerify,
  logout: logoutSession,
};

function SessionWorkspace({
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
  const [session, setSession] = useState<{
    queue: MusicQueue;
    player: PlayerController;
    footprintClient: ReturnType<typeof createFootprintClient>;
  } | null>(null);
  const [footprintRevision, setFootprintRevision] = useState(0);
  useEffect(() => {
    const queue = new MusicQueue();
    const footprintClient = createFootprintClient();
    const reports = new Set<AbortController>();
    let disposed = false;
    const player = createPlayerController({
      queue,
      resolveUrl: (track, signal) => resolvePlaybackUrl(track, undefined, signal),
      onPlayed: async (track) => {
        if (disposed || track.kind !== 'song') return;
        const controller = new AbortController();
        reports.add(controller);
        try {
          await footprintClient.report(
            { ...track, durationMs: durationToMs(track.duration) },
            controller.signal,
          );
          if (!disposed) setFootprintRevision((value) => value + 1);
        } finally {
          reports.delete(controller);
        }
      },
    });
    setSession({ queue, player, footprintClient });
    return () => {
      disposed = true;
      reports.forEach((controller) => controller.abort());
      reports.clear();
      player.destroy();
    };
  }, []);
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

// App 只调度身份和会话；音频属于认证后的会话，不属于任何单个页面。
function SessionApp({ api = services }: { api?: AppServices }) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentLocation = useRef(location.key);
  currentLocation.current = location.key;
  const page = workspacePage(location.pathname);
  const adminRoute = location.pathname === adminPath;
  const knownRoute = Boolean(
    page || adminRoute || location.pathname === '/' || location.pathname === '/login',
  );
  const destination = useRef(
    loginDestination(
      location.pathname === '/login'
        ? new URLSearchParams(location.search).get('next')
        : location.pathname,
    ),
  );
  const [stage, setStage] = useState<Stage>(() =>
    location.pathname === '/' ? 'entry' : 'restoring',
  );
  const [role, setRole] = useState<Role>('user');
  const generation = useRef(0);
  const disposed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      generation.current++;
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => () => clearTimeout(timer.current), [location.key]);
  const enter = async (direct = false) => {
    const current = ++generation.current;
    const requestLocation = location.key;
    setStage('restoring');
    let user;
    try {
      user = await api.restore();
    } catch {
      user = null;
    }
    if (
      disposed.current ||
      current !== generation.current ||
      requestLocation !== currentLocation.current
    )
      return;
    if (user) {
      setRole(user.role);
      setStage(direct ? 'workspace' : 'authorized');
      if (direct) navigate(destination.current, { replace: true });
    } else {
      setStage('login');
      navigate(`/login?next=${encodeURIComponent(destination.current)}`, { replace: true });
    }
  };
  useEffect(() => {
    if (knownRoute && stage === 'restoring') {
      if (location.pathname === '/') setStage('entry');
      else void enter(true);
    }
    // 只在待恢复入口变化时重试；迟到结果不得覆盖新的历史位置。
  }, [knownRoute, location.key]);
  useEffect(() => {
    if (page || adminRoute) destination.current = location.pathname;
    else if (location.pathname === '/login')
      destination.current = loginDestination(new URLSearchParams(location.search).get('next'));
    if (stage === 'login' && (page || adminRoute)) {
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
    }
    if (stage === 'workspace' && (location.pathname === '/' || location.pathname === '/login')) {
      navigate(destination.current, { replace: true });
    }
  }, [location.pathname, location.search, page, adminRoute, stage, navigate]);
  const authenticate = async (credentials: LoginCredentials) => {
    const current = generation.current;
    const requestLocation = location.key;
    const result = await api.login(credentials);
    if (
      disposed.current ||
      current !== generation.current ||
      requestLocation !== currentLocation.current
    )
      return {};
    if (!result.user) return result;
    return { role: result.user.role };
  };
  const verified = (nextRole: Role) => {
    if (disposed.current) return;
    clearTimeout(timer.current);
    const current = generation.current;
    const requestLocation = location.key;
    timer.current = setTimeout(() => {
      if (
        disposed.current ||
        current !== generation.current ||
        requestLocation !== currentLocation.current
      )
        return;
      setRole(nextRole);
      setStage('authorized');
    }, 1150);
  };
  const logout = async () => {
    await api.logout();
    if (disposed.current) return;
    generation.current++;
    clearTimeout(timer.current);
    setStage('login');
    navigate(`/login?next=${encodeURIComponent(destination.current)}`, { replace: true });
  };
  if (!knownRoute) return <NotFound />;
  if (stage === 'restoring')
    return (
      <main className="application-standalone">
        <p role="status">正在验证登录会话…</p>
      </main>
    );
  if (stage === 'entry')
    return (
      <EntryPage
        onEnter={() => {
          void enter();
        }}
      />
    );
  if (stage === 'login')
    return <LoginPage key={location.key} onAuthenticate={authenticate} onVerified={verified} />;
  if (stage === 'authorized')
    return (
      <AuthorizedSequence
        role={role}
        onComplete={() => {
          setStage('workspace');
          navigate(destination.current, { replace: true });
        }}
      />
    );
  if (adminRoute)
    return role === 'admin' ? (
      <AdminApplicationsPage onLogout={logout} />
    ) : (
      <main className="application-standalone">
        <h2>无权访问申请审核</h2>
        <p>此页面仅供已完成两步验证的管理员使用。</p>
        <Link to={workspacePaths.archive}>返回音乐俱乐部</Link>
      </main>
    );
  return (
    <SessionWorkspace
      role={role}
      page={page ?? 'archive'}
      onNavigate={(next) => navigate(workspacePaths[next])}
      onLogout={logout}
    />
  );
}

function NotFound() {
  return (
    <main className="application-standalone">
      <h1>页面不存在</h1>
      <p>这个地址尚未开放，或已发生变更。</p>
      <Link to={workspacePaths.archive}>返回音乐库</Link>
    </main>
  );
}

// 凭证只留在当前组件内存；首次渲染即移除 fragment，邮件扫描 GET 不会提交验证。
function ApplicationRoute({ purpose }: { purpose: 'activate' | 'verify' }) {
  const [token] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
    const token = /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
    window.history.replaceState(window.history.state, '', window.location.pathname);
    return token;
  });
  return <ApplicationLinkPage purpose={purpose} initialToken={token} />;
}

export function App({ api = services }: { api?: AppServices }) {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/activate" element={<ApplicationRoute key="activate" purpose="activate" />} />
        <Route path="/verify-email" element={<ApplicationRoute key="verify" purpose="verify" />} />
        <Route path="*" element={<SessionApp api={api} />} />
      </Routes>
    </BrowserRouter>
  );
}
