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
  const [feedbackError, setFeedbackError] = useState(false);
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
  const readController = useRef<AbortController | null>(null);
  const readSerial = useRef(0);
  const validationFailed = useRef(false);
  const reload = useCallback(
    async (background = false) => {
      if (!enabled.current) return;
      // focus 和 visibilitychange 通常紧邻触发，同一次返页只保留一条校验请求。
      if (background && readController.current && !readController.current.signal.aborted) return;
      readController.current?.abort();
      const pending = new AbortController();
      readController.current = pending;
      const request = ++readSerial.current;
      const lifetime = background ? generation.current : ++generation.current;
      const current = () =>
        enabled.current &&
        !pending.signal.aborted &&
        request === readSerial.current &&
        lifetime === generation.current;
      if (!background) {
        controller.current?.abort();
        busyRef.current = false;
        setBusy(false);
        setPhase('loading');
        setFeedbackError(false);
        setNotice('正在验证工坊会话…');
      }
      try {
        const next = await api.read(pending.signal);
        if (!current()) return;
        const changed =
          next.context !== sessionRef.current?.context ||
          next.viewerId !== sessionRef.current?.viewerId;
        if (background && !changed) {
          // 同一会话只校验身份，不回写列表或草稿，不重建工坊，也不打断并发保存。
          if (validationFailed.current) {
            validationFailed.current = false;
            setFeedbackError(false);
            setNotice('');
          }
          return;
        }
        if (changed) {
          controller.current?.abort();
          generation.current += 1;
          busyRef.current = false;
          setBusy(false);
          setConfig(next.outfits.find((item) => item.current)?.config ?? defaultConfig);
          setName('我的音乐形象');
        }
        acceptSession(next);
        validationFailed.current = false;
        setFeedbackError(false);
        setPhase('ready');
        setNotice('');
      } catch (error) {
        if (!current()) return;
        const invalidSession = error instanceof AvatarError && [401, 403].includes(error.status);
        if (background && sessionRef.current && !invalidSession) {
          // 短暂断网保留编辑成果；写请求仍由后端校验 Session 和工坊上下文。
          validationFailed.current = true;
          setFeedbackError(true);
          setNotice(error instanceof Error ? error.message : '暂时无法验证登录状态，请稍后重试');
          return;
        }
        controller.current?.abort();
        generation.current += 1;
        busyRef.current = false;
        setBusy(false);
        acceptSession(null);
        setFeedbackError(true);
        setConfig(defaultConfig);
        setName('我的音乐形象');
        setPhase(invalidSession ? 'expired' : 'error');
        setNotice(error instanceof Error ? error.message : '工坊读取失败');
      } finally {
        if (readController.current === pending) readController.current = null;
      }
    },
    [api],
  );

  useEffect(() => {
    if (active) void reload();
    else {
      acceptSession(null);
      setConfig(defaultConfig);
      setName('我的音乐形象');
    }
    const onReturn = () => {
      if (!document.hidden) void reload(true);
    };
    if (active) {
      window.addEventListener('focus', onReturn);
      document.addEventListener('visibilitychange', onReturn);
    }
    return () => {
      controller.current?.abort();
      readController.current?.abort();
      generation.current += 1;
      readSerial.current += 1;
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
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
    setFeedbackError(false);
    validationFailed.current = false;
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
      validationFailed.current = false;
      setFeedbackError(false);
      setNotice(message);
      return true;
    } catch (error) {
      if (!current()) return false;
      validationFailed.current = false;
      setFeedbackError(true);
      if (error instanceof AvatarError && [401, 403, 409].includes(error.status)) {
        // 写入已确认会话失效，较早发出的后台读取不能再恢复旧身份。
        readController.current?.abort();
        readSerial.current += 1;
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
      setFeedbackError(true);
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
    feedbackError,
    busy,
    reload,
    save,
    rename,
    select,
    remove,
  };
}
