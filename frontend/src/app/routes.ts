// 主页面地址集中维护；后续页面可在此扩展，不绑定个人页面内部的分类。
export const workspacePaths = {
  archive: '/library',
  upload: '/upload',
  user: '/user',
  footprint: '/footprint',
} as const
export type WorkspacePage = keyof typeof workspacePaths
export const adminPath = '/admin/applications'
export function workspacePage(pathname: string): WorkspacePage | undefined {
  return (Object.keys(workspacePaths) as WorkspacePage[]).find(page => workspacePaths[page] === pathname)
}
// 登录返回地址只接受明确登记的业务路径，拒绝外站和未实现页面。
export function loginDestination(value: string | null): string {
  return value && (workspacePage(value) || value === adminPath) ? value : workspacePaths.archive
}
