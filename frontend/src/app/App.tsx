import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage.tsx';
import { ApplicationLinkPage } from '../features/auth/ApplicationLinkPage.tsx';
import { SessionApp } from './SessionApp.tsx';
import type { AppServices } from './hooks/use-auth-machine.ts';
export type { AppServices } from './hooks/use-auth-machine.ts';

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

export function App({ api }: { api?: AppServices }) {
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
