import { Link } from 'react-router';
import { EntryPage } from '../features/auth/EntryPage.tsx';
import { LoginPage } from '../features/auth/LoginPage.tsx';
import { AuthorizedSequence } from '../features/auth/AuthorizedSequence.tsx';
import { AdminApplicationsPage } from '../features/auth/AdminApplicationsPage.tsx';
import { workspacePaths } from './routes.ts';
import { useAuthMachine, type AppServices } from './hooks/use-auth-machine.ts';
import { SessionWorkspace } from './SessionWorkspace.tsx';

// 原阶段视图只接收状态机结果，不另持有认证状态。
export function SessionApp({ api }: { api?: AppServices }) {
  const {
    stage,
    role,
    page,
    adminRoute,
    knownRoute,
    locationKey,
    enter,
    authenticate,
    verified,
    logout,
    completeAuthorization,
    navigatePage,
  } = useAuthMachine(api);
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
    return <LoginPage key={locationKey} onAuthenticate={authenticate} onVerified={verified} />;
  if (stage === 'authorized')
    return <AuthorizedSequence role={role} onComplete={completeAuthorization} />;
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
      onNavigate={navigatePage}
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
