import { useRef, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import type { UserProfile } from '../../../services/music/personal-library.ts';
import type { PersonalLibraryClient } from '../types.ts';

export function validateAvatarFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    return '请选择 JPG、PNG 或 WebP 图片。';
  if (file.size === 0 || file.size > 5 * 1024 * 1024) return '请选择大小不超过 5 MB 的有效图片。';
  return null;
}

export function useProfile(api: PersonalLibraryClient, unmountedRef: RefObject<boolean>) {
  const profileRef = useRef<UserProfile | null>(null);
  const revisionRef = useRef(0);
  const avatarBusyRef = useRef(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [nickname, setNickname] = useState('REGISTERED MEMBER / 社区成员');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFeedback, setAvatarFeedback] = useState('点击头像更换图片');

  function acceptProfile(next: UserProfile, revision: number) {
    if (revision !== revisionRef.current) return;
    profileRef.current = next;
    setNickname(next.nickname);
    // 头像地址在展示前再次限制为当前用户的受保护接口。
    setAvatarUrl(next.avatarUrl);
  }

  function clearProfile() {
    profileRef.current = null;
    revisionRef.current += 1;
    setNickname('会话已失效');
    setAvatarUrl(null);
  }

  async function onAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || avatarBusyRef.current) return;
    const error = validateAvatarFile(file);
    if (error) {
      setAvatarFeedback(error);
      return;
    }
    avatarBusyRef.current = true;
    setAvatarFeedback('正在保存头像…');
    try {
      const saved = await api.uploadAvatar(file);
      if (unmountedRef.current) return;
      // 让更早发出的 profile 请求知道头像已被更新，避免旧响应覆盖新头像。
      revisionRef.current += 1;
      profileRef.current = saved;
      setNickname(saved.nickname);
      setAvatarUrl(saved.avatarUrl);
      setAvatarFeedback('头像已保存，下次登录仍可见');
    } catch (error) {
      if (!unmountedRef.current)
        setAvatarFeedback(error instanceof Error ? error.message : '头像保存失败');
    } finally {
      avatarBusyRef.current = false;
    }
  }

  const avatarSrc =
    avatarUrl && /^\/api\/me\/avatar\?v=[a-z0-9-]+$/.test(avatarUrl) ? avatarUrl : undefined;
  function chooseAvatar() {
    if (!avatarBusyRef.current) avatarInputRef.current?.click();
  }
  return {
    profileRef,
    revisionRef,
    acceptProfile,
    clearProfile,
    nickname,
    avatarUrl,
    avatarSrc,
    avatarFeedback,
    avatarInputRef,
    onAvatarChange,
    chooseAvatar,
  };
}
