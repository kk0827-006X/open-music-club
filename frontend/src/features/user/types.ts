import type { createPersonalLibraryClient } from '../../services/music/personal-library.ts';

export type PersonalLibraryClient = ReturnType<typeof createPersonalLibraryClient>;
export type UserSection = 'playlists' | 'favorites' | 'recent' | 'uploads' | 'admin';
export const sections: { id: UserSection; label: string; english: string }[] = [
  { id: 'playlists', label: '歌单', english: 'PLAYLISTS' },
  { id: 'favorites', label: '喜爱', english: 'FAVORITES' },
  { id: 'recent', label: '最近播放', english: 'RECENTLY PLAYED' },
  { id: 'uploads', label: '我的上传', english: 'MY UPLOADS' },
];
export const headings: Record<UserSection, string> = {
  playlists: '我的歌单',
  favorites: '我的喜爱',
  recent: '最近播放',
  uploads: '我的上传',
  admin: '申请审核',
};
