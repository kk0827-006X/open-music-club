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
    const identityChanged = profileRef.current !== null && profileRef.current.id !== next.id;
    // 当前刷新确认身份已变化时优先切换；同一身份的旧资料仍服从头像版本保护。
    if (!identityChanged && revision !== revisionRef.current) return;
    if (identityChanged) {
      revisionRef.current += 1;
      setAvatarFeedback('点击头像更换图片');
    }
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
    setAvatarFeedback('会话已失效，请重新登录后更换头像');
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
    const revision = revisionRef.current;
    const ownerId = profileRef.current?.id;
    // 请求开始时的身份与资料代次必须仍然有效，清空或切换身份后丢弃迟到结果。
    const current = () =>
      !unmountedRef.current &&
      revision === revisionRef.current &&
      (ownerId === undefined || ownerId === profileRef.current?.id);
    avatarBusyRef.current = true;
    setAvatarFeedback('正在保存头像…');
    try {
      const saved = await api.uploadAvatar(file);
      if (!current()) return;
      // 首次资料未就绪时也允许上传，但成功结果必须属于随后确认的当前身份。
      if (profileRef.current && saved.id !== profileRef.current.id) {
        setAvatarFeedback('资料已变化，请重新选择头像');
        return;
      }
      // 让更早发出的 profile 请求知道头像已被更新，避免旧响应覆盖新头像。
      revisionRef.current += 1;
      profileRef.current = saved;
      setNickname(saved.nickname);
      setAvatarUrl(saved.avatarUrl);
      setAvatarFeedback('头像已保存，下次登录仍可见');
    } catch (error) {
      if (current()) setAvatarFeedback(error instanceof Error ? error.message : '头像保存失败');
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
