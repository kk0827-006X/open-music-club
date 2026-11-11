import { useEffect, useRef, useState } from 'react';
import type { RefObject, FormEvent } from 'react';
import type { UserPlaylist } from '../../../services/music/personal-library.ts';
import type { PersonalLibraryClient } from '../types.ts';
import type { PlaylistHeaderProps } from '../PlaylistHeader.tsx';
import type { usePersonalLibraryData } from './use-personal-library-data.ts';

export function usePlaylistMutations({
  api,
  data,
  unmountedRef,
  pageRef,
  changed,
}: {
  api: PersonalLibraryClient;
  data: ReturnType<typeof usePersonalLibraryData>;
  unmountedRef: RefObject<boolean>;
  pageRef: RefObject<HTMLElement | null>;
  changed?: () => void;
}) {
  const {
    busyRef,
    loadingRef,
    listsRef,
    refreshRef,
    setBusy,
    setSection,
    setSelectedId,
    setPageIndex,
    notice,
    mutate,
  } = data;
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameSessionRef = useRef(0);
  const renameIdRef = useRef<number | null>(null);
  const renameValueRef = useRef('');
  const focusRenameAfterCancelRef = useRef<number | null>(null);
  const [renameId, setRenameIdState] = useState<number | null>(null);
  const [renameValue, setRenameValueState] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState('');

  function cancelRename(focusButton = false) {
    // 每次开始/取消都推进会话号，旧输入的 blur 回调不能保存到新一轮重命名。
    renameSessionRef.current += 1;
    const id = renameIdRef.current;
    renameIdRef.current = null;
    renameValueRef.current = '';
    setRenameIdState(null);
    setRenameValueState('');
    if (focusButton && id !== null) focusRenameAfterCancelRef.current = id;
  }

  function startRename(list: UserPlaylist) {
    renameSessionRef.current += 1;
    renameIdRef.current = list.id;
    renameValueRef.current = list.name;
    setRenameIdState(list.id);
    setRenameValueState(list.name);
  }

  function saveRename(id: number, session: number) {
    // Escape 会先取消并推进会话号，随后到达的 blur 必须被丢弃。
    if (session !== renameSessionRef.current) return;
    if (busyRef.current || unmountedRef.current || renameIdRef.current !== id) return;
    const name = renameValueRef.current.trim();
    if (!name || name.length > 100) {
      notice('歌单名称需要填写 1 到 100 个字符', true);
      renameInputRef.current?.focus();
      return;
    }
    if (listsRef.current.find((list) => list.id === id)?.name === name) {
      cancelRename();
      return;
    }
    cancelRename();
    void mutate(() => api.renamePlaylist(id, name), '歌单名称已保存');
  }

  function openCreateDialog() {
    if (busyRef.current || loadingRef.current) return;
    setCreateError('');
    setCreateName('');
    setCreateOpen(true);
  }

  async function onCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = createName.trim();
    if (!name || busyRef.current) return;
    setBusy(true);
    try {
      await api.createPlaylist(name);
      if (unmountedRef.current) return;
      setCreateOpen(false);
      setSection('playlists');
      setSelectedId(null);
      setPageIndex(0);
      if (await refreshRef.current()) notice('歌单已保存');
      changed?.();
    } catch (error) {
      if (!unmountedRef.current)
        setCreateError(error instanceof Error ? error.message : '保存失败');
    } finally {
      if (!unmountedRef.current) setBusy(false);
    }
  }

  function openDeleteDialog(list: UserPlaylist) {
    if (busyRef.current || loadingRef.current) return;
    setDeletingId(list.id);
    setDeleteError('');
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    const id = deletingId;
    if (busyRef.current || loadingRef.current || id === null) return;
    setDeleteError('');
    setBusy(true);
    try {
      await api.deletePlaylist(id);
      if (unmountedRef.current) return;
      setDeletingId(null);
      setDeleteOpen(false);
      setSelectedId(null);
      setPageIndex(0);
      if (await refreshRef.current()) notice('歌单已删除');
      changed?.();
    } catch (error) {
      if (!unmountedRef.current)
        setDeleteError(error instanceof Error ? error.message : '删除失败，请重试');
    } finally {
      if (!unmountedRef.current) setBusy(false);
    }
  }

  useEffect(() => {
    if (createOpen) createInputRef.current?.focus();
  }, [createOpen]);

  useEffect(() => {
    if (renameId !== null) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
      return;
    }
    // Escape 取消后把焦点还给原歌单名称按钮。
    const id = focusRenameAfterCancelRef.current;
    if (id === null) return;
    focusRenameAfterCancelRef.current = null;
    pageRef.current?.querySelector<HTMLButtonElement>(`[data-user-rename="${id}"]`)?.focus();
  }, [renameId]);

  data.beforeRefreshRef.current = cancelRename;
  useEffect(
    () => () => {
      renameSessionRef.current += 1;
    },
    [],
  );

  function closeDelete() {
    if (busyRef.current) return;
    setDeletingId(null);
    setDeleteOpen(false);
  }

  // 固定本轮渲染的会话号，迟到的 blur 不能提交下一轮输入。
  const renameSession = renameSessionRef.current;
  function headerProps(list: UserPlaylist): Partial<PlaylistHeaderProps> {
    return {
      renaming: renameId === list.id,
      renameValue,
      renameInputRef,
      onStartRename: () => startRename(list),
      onRenameValueChange: (value) => {
        renameValueRef.current = value;
        setRenameValueState(value);
      },
      onRenameSubmit: () => saveRename(list.id, renameSession),
      onRenameKeyDown: (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        cancelRename(true);
      },
      onRenameBlur: (event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        saveRename(list.id, renameSession);
      },
      onDelete: () => openDeleteDialog(list),
    };
  }
  return {
    headerProps,
    openCreateDialog,
    hasOpenDialog: createOpen || deleteOpen,
    create: {
      open: createOpen,
      name: createName,
      error: createError,
      inputRef: createInputRef,
      onNameChange: setCreateName,
      onClose: () => setCreateOpen(false),
      onSubmit: onCreateSubmit,
    },
    deletion: {
      open: deleteOpen,
      name: data.lists.find((list) => list.id === deletingId)?.name || '',
      error: deleteError,
      onClose: closeDelete,
      onConfirm: confirmDelete,
    },
  };
}
