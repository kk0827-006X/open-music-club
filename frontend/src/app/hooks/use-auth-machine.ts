import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  adminPath,
  loginDestination,
  workspacePage,
  workspacePaths,
  type WorkspacePage,
} from '../routes.ts';
import {
  loginAndVerify,
  logoutSession,
  restoreSession,
  type LoginCredentials,
} from '../../services/auth/session.ts';

export type Role = 'admin' | 'user';
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

// 原认证状态机：身份代次、历史位置和卸载标记共同隔离迟到响应。
export function useAuthMachine(api: AppServices = services) {
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
  const completeAuthorization = () => {
    setStage('workspace');
    navigate(destination.current, { replace: true });
  };
  const navigatePage = (next: WorkspacePage) => navigate(workspacePaths[next]);
  return {
    stage,
    role,
    page,
    adminRoute,
    knownRoute,
    locationKey: location.key,
    enter,
    authenticate,
    verified,
    logout,
    completeAuthorization,
    navigatePage,
  };
}
