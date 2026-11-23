import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  createFriendsClient,
  FriendsError,
  type FriendRow,
  type FriendsView,
} from '../../services/friends.ts';
import { Icon, IconButton, Modal, ModalAction } from '../../shared/react/ui.tsx';

const views = [
  { id: 'friends', label: '好友列表', empty: '还没有好友' },
  { id: 'incoming', label: '收到的请求', empty: '没有待处理的请求' },
  { id: 'outgoing', label: '已提交', empty: '没有已提交的申请' },
] as const;
const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });
type Dialog = { kind: 'add' } | { kind: 'remove'; row: FriendRow };
type Listing = {
  key: string;
  rows: FriendRow[];
  hasMore: boolean;
  error?: string;
};

function errorMessage(error: unknown) {
  return error instanceof FriendsError ? error.message : '操作暂不可用，请重试';
}

export function FriendsPanel({
  active,
  onDialogChange,
}: {
  active: boolean;
  onDialogChange(open: boolean): void;
}) {
  const client = useMemo(() => createFriendsClient(), []);
  const [view, setView] = useState<FriendsView>('friends');
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [listing, setListing] = useState<Listing | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [dialogError, setDialogError] = useState('');
  const write = useRef<AbortController | null>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const dialogTitle = useId();
  const emailId = useId();
  const key = `${view}:${page}:${revision}`;
  const result = listing?.key === key ? listing : null;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setListing(null);
    void client.list(view, page, controller.signal).then(
      ({ rows, hasMore }) => {
        if (controller.signal.aborted) return;
        if (page > 0 && rows.length === 0) setPage(page - 1);
        else setListing({ key, rows, hasMore });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setListing({ key, rows: [], hasMore: false, error: errorMessage(error) });
      },
    );
    return () => controller.abort();
  }, [active, client, key, page, view]);

  useEffect(() => {
    if (!active) {
      setDialog(null);
      setEmail('');
      setDialogError('');
      setPending(false);
      setNotice(null);
    }
    return () => {
      write.current?.abort();
      write.current = null;
      onDialogChange(false);
    };
  }, [active, onDialogChange]);

  useEffect(() => {
    if (active && dialog?.kind === 'add') emailInput.current?.focus();
  }, [active, dialog]);

  function refresh() {
    setRevision((value) => value + 1);
  }

  function showDialog(next: Dialog | null) {
    setDialog(next);
    setEmail('');
    setDialogError('');
    onDialogChange(Boolean(next));
  }

  async function runAction(
    action: (signal: AbortSignal) => Promise<void>,
    success: string,
    fromDialog = false,
  ) {
    if (!active || write.current) return;
    const controller = new AbortController();
    write.current = controller;
    setPending(true);
    setNotice(null);
    setDialogError('');
    try {
      await action(controller.signal);
      if (controller.signal.aborted) return;
      if (fromDialog) showDialog(null);
      setNotice({ text: success });
      refresh();
    } catch (error) {
      if (controller.signal.aborted) return;
      if (fromDialog) setDialogError(errorMessage(error));
      else setNotice({ text: errorMessage(error), error: true });
      if (error instanceof FriendsError && [401, 404].includes(error.status)) refresh();
    } finally {
      if (write.current === controller) {
        write.current = null;
        setPending(false);
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialog?.kind === 'add') {
      const address = email.trim();
      if (!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(address)) {
        setDialogError('请输入完整的邮箱地址');
        emailInput.current?.focus();
        return;
      }
      void runAction((signal) => client.submit(address, signal), '申请已提交', true);
    } else if (dialog?.kind === 'remove') {
      const { id } = dialog.row;
      void runAction((signal) => client.remove(id, signal), '已解除好友关系', true);
    }
  }

  function rowActions(row: FriendRow) {
    if (view === 'incoming')
      return (
        <>
          <button
            type="button"
            className="friends-button--primary"
            disabled={pending}
            onClick={() =>
              void runAction((signal) => client.reply(row.id, 'accept', signal), '已添加好友')
            }
          >
            接受
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              void runAction((signal) => client.reply(row.id, 'decline', signal), '已拒绝请求')
            }
          >
            拒绝
          </button>
        </>
      );
    if (view === 'outgoing')
      return (
        <button
          type="button"
          disabled={pending}
          onClick={() => void runAction((signal) => client.withdraw(row.id, signal), '已撤回申请')}
        >
          撤回
        </button>
      );
    return (
      <button type="button" disabled={pending} onClick={() => showDialog({ kind: 'remove', row })}>
        解除好友
      </button>
    );
  }

  return (
    <section className="friends-panel" data-friends-panel aria-label="好友管理">
      <div className="friends-toolbar">
        <div className="friends-views" role="group" aria-label="好友分类">
          {views.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              disabled={pending}
              onClick={() => {
                setNotice(null);
                setPage(0);
                setView(id);
                refresh();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <IconButton
          icon="plus"
          className="friends-add"
          aria-label="添加好友"
          disabled={pending}
          onClick={() => showDialog({ kind: 'add' })}
        />
      </div>
      {notice && (
        <p className="friends-notice" role={notice.error ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}
      <div className="friends-list" aria-busy={!result || pending}>
        {!result ? (
          <p className="friends-empty" role="status">
            正在加载…
          </p>
        ) : result.error ? (
          <div className="friends-empty">
            <p role="alert">{result.error}</p>
            <div className="user-dialog-actions">
              <button type="button" onClick={refresh}>
                重试
              </button>
            </div>
          </div>
        ) : result.rows.length === 0 ? (
          <p className="friends-empty">{views.find(({ id }) => id === view)?.empty}</p>
        ) : (
          <ul aria-label={views.find(({ id }) => id === view)?.label}>
            {result.rows.map((row) => {
              const date = new Date(row.date);
              return (
                <li key={row.id} className="friends-row">
                  <span className="friends-row-icon">
                    <Icon name="user" />
                  </span>
                  <strong>{row.label}</strong>
                  {Number.isFinite(date.getTime()) && (
                    <time dateTime={row.date}>{dateFormat.format(date)}</time>
                  )}
                  <div className="user-dialog-actions friends-row-actions">{rowActions(row)}</div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {(page > 0 || result?.hasMore) && (
        <nav className="user-pagination" aria-label="好友列表翻页">
          <IconButton
            icon="left"
            aria-label="上一页"
            disabled={pending || page === 0 || !result}
            onClick={() => setPage(page - 1)}
          />
          <span>第 {page + 1} 页</span>
          <IconButton
            icon="right"
            aria-label="下一页"
            disabled={pending || !result?.hasMore}
            onClick={() => setPage(page + 1)}
          />
        </nav>
      )}
      <Modal
        open={active && !!dialog}
        busy={pending}
        onClose={() => showDialog(null)}
        className="user-create-dialog friends-dialog"
        aria-labelledby={dialogTitle}
        closeButton={{ label: '关闭' }}
      >
        <form onSubmit={submit}>
          <h2 id={dialogTitle}>{dialog?.kind === 'remove' ? '解除好友' : '添加好友'}</h2>
          {dialog?.kind === 'remove' ? (
            <p>解除与「{dialog.row.label}」的好友关系？</p>
          ) : (
            <>
              <label htmlFor={emailId}>对方的邮箱</label>
              <input
                id={emailId}
                ref={emailInput}
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
                maxLength={254}
                value={email}
                disabled={pending}
                onChange={(event) => setEmail(event.currentTarget.value)}
              />
            </>
          )}
          {dialogError && (
            <p className="friends-notice" role="alert">
              {dialogError}
            </p>
          )}
          <div className="user-dialog-actions">
            <ModalAction variant="cancel" disabled={pending} onClick={() => showDialog(null)}>
              取消
            </ModalAction>
            <ModalAction type="submit" disabled={pending}>
              {pending ? '正在处理…' : dialog?.kind === 'remove' ? '确认解除' : '发送申请'}
            </ModalAction>
          </div>
        </form>
      </Modal>
    </section>
  );
}
