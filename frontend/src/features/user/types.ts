import type { createPersonalLibraryClient } from '../../services/music/personal-library.ts';

export type PersonalLibraryClient = ReturnType<typeof createPersonalLibraryClient>;
export type UserSection = 'playlists' | 'favorites' | 'uploads' | 'avatar' | 'admin';
export const sections: { id: UserSection; label: string; english: string }[] = [
  { id: 'playlists', label: '歌单', english: 'PLAYLISTS' },
  { id: 'favorites', label: '喜爱', english: 'FAVORITES' },
  { id: 'uploads', label: '我的上传', english: 'MY UPLOADS' },
  { id: 'avatar', label: '像素工坊', english: 'AVATAR STUDIO' },
];
export const headings: Record<UserSection, string> = {
  playlists: '我的歌单',
  favorites: '我的喜爱',
  uploads: '我的上传',
  avatar: '像素小人工坊',
  admin: '申请审核',
};
