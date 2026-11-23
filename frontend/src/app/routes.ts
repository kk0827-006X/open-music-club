// 在这里集中维护工作区主页面及可直接访问的子页面。
export const workspacePaths = {
  archive: '/library',
  user: '/user',
  userUploads: '/user/uploads',
  userUpload: '/user/uploads/new',
  footprint: '/footprint',
} as const;
export type WorkspaceRoute = keyof typeof workspacePaths;
export type WorkspacePage = Exclude<WorkspaceRoute, 'userUploads' | 'userUpload'>;
export const legacyUploadPath = '/upload';
export const adminPath = '/admin/applications';
export function workspacePage(pathname: string): WorkspaceRoute | undefined {
  if (pathname === legacyUploadPath) return 'userUpload';
  return (Object.keys(workspacePaths) as WorkspaceRoute[]).find(
    (page) => workspacePaths[page] === pathname,
  );
}
export function workspaceParent(route: WorkspaceRoute): WorkspacePage {
  return route === 'userUploads' || route === 'userUpload' ? 'user' : route;
}
// 登录返回地址只接受明确登记的业务路径，拒绝外站和未实现页面。
export function loginDestination(value: string | null): string {
  if (value === adminPath) return adminPath;
  const route = value ? workspacePage(value) : undefined;
  return route ? workspacePaths[route] : workspacePaths.archive;
}
