import { useCallback, useEffect, useRef, useState } from 'react';
import { AvatarError, type createAvatarClient } from '../../services/avatar-studio.ts';
import {
  defaultConfig,
  type AvatarConfig,
  type AvatarOutfit,
  type AvatarSession,
} from './model.ts';

export function useAvatarStudio(active: boolean, api: ReturnType<typeof createAvatarClient>) {
  const [session, setSession] = useState<AvatarSession | null>(null);
  const sessionRef = useRef<AvatarSession | null>(null);
  const [config, setConfig] = useState<AvatarConfig>(defaultConfig);
  const [name, setName] = useState('我的音乐形象');
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'expired'>('loading');
  const [notice, setNotice] = useState('正在验证工坊会话…');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const enabled = useRef(active);
  enabled.current = active;
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const acceptSession = (value: AvatarSession | null) => {
    sessionRef.current = value;
    setSession(value);
  };
  const reload = useCallback(async () => {
    if (!enabled.current) return;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    const serial = ++generation.current;
    busyRef.current = false;
    setBusy(false);
    setPhase('loading');
    setNotice('正在验证工坊会话…');
    try {
      const next = await api.read(pending.signal);
      if (pending.signal.aborted || generation.current !== serial || !enabled.current) return;
      const changed =
        next.context !== sessionRef.current?.context ||
        next.viewerId !== sessionRef.current?.viewerId;
      acceptSession(next);
      if (changed) {
        setConfig(next.outfits.find((item) => item.current)?.config ?? defaultConfig);
        setName('我的音乐形象');
      }
      setPhase('ready');
      setNotice('仅你可见 · 形象已按当前登录账号保存');
    } catch (error) {
      if (pending.signal.aborted || generation.current !== serial || !enabled.current) return;
      acceptSession(null);
      setConfig(defaultConfig);
      setName('我的音乐形象');
      setPhase(
        error instanceof AvatarError && [401, 403].includes(error.status) ? 'expired' : 'error',
      );
      setNotice(error instanceof Error ? error.message : '工坊读取失败');
    }
  }, [api]);

  useEffect(() => {
    if (active) void reload();
    else {
      acceptSession(null);
      setConfig(defaultConfig);
      setName('我的音乐形象');
    }
    const onFocus = () => {
      if (!document.hidden) void reload();
    };
    const onVisibility = () => {
      if (document.hidden) {
        // 切到其他标签页可能发生退出或身份切换；返回时先验证，再显示私人数据。
        controller.current?.abort();
        generation.current += 1;
        setPhase('loading');
      } else void reload();
    };
    if (active) {
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      controller.current?.abort();
      generation.current += 1;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, reload]);

  async function mutate(
    action: (context: string, signal: AbortSignal) => Promise<unknown>,
    apply: (value: unknown, previous: AvatarSession) => AvatarSession,
    message: string,
  ) {
    const owner = sessionRef.current;
    if (!enabled.current || phase !== 'ready' || !owner || busyRef.current) return false;
    const serial = generation.current;
    const pending = new AbortController();
    controller.current = pending;
    busyRef.current = true;
    setBusy(true);
    setNotice('正在保存更改…');
    const current = () =>
      enabled.current &&
      !pending.signal.aborted &&
      serial === generation.current &&
      sessionRef.current?.context === owner.context;
    try {
      const result = await action(owner.context, pending.signal);
      if (!current()) return false;
      acceptSession(apply(result, sessionRef.current!));
      setNotice(message);
      return true;
    } catch (error) {
      if (!current()) return false;
      if (error instanceof AvatarError && [401, 403, 409].includes(error.status)) {
        acceptSession(null);
        setConfig(defaultConfig);
        setName('我的音乐形象');
        setPhase('expired');
      }
      setNotice(error instanceof Error ? error.message : '形象保存失败，请重试');
      return false;
    } finally {
      if (current() || (serial === generation.current && !pending.signal.aborted)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  function save(title = name.trim()) {
    if (!title) {
      setNotice('请填写形象名称');
      return Promise.resolve(false);
    }
    return mutate(
      (context, signal) => api.save(context, title, config, signal),
      (value, previous) => ({
        ...previous,
        outfits: [(value as { outfit: AvatarOutfit }).outfit, ...previous.outfits],
      }),
      '形象已保存到你的形象库',
    );
  }
  function rename(id: number, title: string) {
    return mutate(
      (context, signal) => api.rename(context, id, title, signal),
      (value, previous) => ({
        ...previous,
        outfits: previous.outfits.map((item) =>
          item.id === id ? (value as { outfit: AvatarOutfit }).outfit : item,
        ),
      }),
      '形象已重命名',
    );
  }
  function select(id: number) {
    return mutate(
      (context, signal) => api.select(context, id, signal),
      (_, previous) => {
        return {
          ...previous,
          outfits: previous.outfits.map((item) => ({ ...item, current: item.id === id })),
        };
      },
      '已设为当前工坊形象',
    );
  }
  function remove(id: number) {
    return mutate(
      (context, signal) => api.remove(context, id, signal),
      (_, previous) => ({
        ...previous,
        outfits: previous.outfits.filter((item) => item.id !== id),
      }),
      '形象已删除',
    );
  }
  return {
    session,
    config,
    setConfig,
    name,
    setName,
    phase,
    notice,
    busy,
    reload,
    save,
    rename,
    select,
    remove,
  };
}
