import { Icon, Modal } from '../../shared/react/ui.tsx';
import type { usePlaylistMutations } from './hooks/use-playlist-mutations.ts';

export function DeletePlaylistDialog({
  open: deleteOpen,
  name: deletingName,
  error: deleteError,
  onClose,
  onConfirm: confirmDelete,
  busy,
  loading,
}: ReturnType<typeof usePlaylistMutations>['deletion'] & { busy: boolean; loading: boolean }) {
  return (
    <Modal
      open={deleteOpen}
      onClose={onClose}
      busy={busy}
      className="user-create-dialog user-delete-dialog"
      data-user-delete-dialog
      aria-labelledby="user-delete-title"
      aria-describedby="user-delete-description"
    >
      <header>
        <span>PERSONAL ARCHIVE</span>
        <button
          type="button"
          data-user-delete-cancel
          aria-label="关闭删除确认窗口"
          disabled={busy}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <h2 id="user-delete-title">删除这份歌单？</h2>
      <p id="user-delete-description">
        确定删除「<strong data-user-delete-name>{deletingName}</strong>
        」吗？此操作不可撤销，但不会删除音乐文件。
      </p>
      <p data-user-delete-feedback role="status">
        {deleteError}
      </p>
      <div className="user-dialog-actions">
        <button type="button" data-user-delete-cancel autoFocus disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="user-confirm-delete"
          data-user-delete-confirm
          disabled={busy || loading}
          onClick={() => void confirmDelete()}
        >
          确认删除
        </button>
      </div>
    </Modal>
  );
}
