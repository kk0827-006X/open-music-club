import { Modal, ModalAction } from '../../shared/react/ui.tsx';
import type { usePlaylistMutations } from './hooks/use-playlist-mutations.ts';

export function CreatePlaylistDialog({
  open: createOpen,
  name: createName,
  error: createError,
  inputRef: createInputRef,
  onNameChange,
  onClose,
  onSubmit: onCreateSubmit,
  busy,
}: ReturnType<typeof usePlaylistMutations>['create'] & { busy: boolean }) {
  return (
    <Modal
      open={createOpen}
      onClose={onClose}
      busy={busy}
      closeButton={{ label: '关闭歌单编辑窗口', marker: 'data-user-dialog-close' }}
      className="user-create-dialog"
      data-user-dialog
      aria-labelledby="user-dialog-title"
    >
      <form data-user-create-form onSubmit={(event) => void onCreateSubmit(event)}>
        <h2 id="user-dialog-title" data-user-dialog-title>
          新建歌单
        </h2>
        <label htmlFor="user-playlist-name">歌单名称</label>
        <input
          id="user-playlist-name"
          ref={createInputRef}
          name="name"
          maxLength={100}
          required
          placeholder="例如：夜晚的留声机"
          value={createName}
          onChange={(event) => onNameChange(event.currentTarget.value)}
        />
        <p data-user-dialog-feedback role="status">
          {createError}
        </p>
        <div className="user-dialog-actions">
          <ModalAction variant="cancel" data-user-dialog-cancel disabled={busy} onClick={onClose}>
            取消
          </ModalAction>
          <ModalAction type="submit" data-user-dialog-submit disabled={busy}>
            创建歌单
          </ModalAction>
        </div>
      </form>
    </Modal>
  );
}
