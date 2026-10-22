import { createElement } from 'react'
import { App, type AppServices } from './App.tsx'
import { mountReactElement } from '../shared/react/mount.ts'

export function mountApplication(root: HTMLElement, overrides?: Partial<AppServices>) {
  const unmount = mountReactElement(root, createElement(App, overrides ? { api: { ...defaultApi, ...overrides } } : {}))
  root.dataset.ready = 'true'
  return { destroy: unmount }
}
import { restoreSession, loginAndVerify, logoutSession } from '../services/auth/session.ts'
const defaultApi: AppServices = { restore: restoreSession, login: loginAndVerify, logout: logoutSession }
