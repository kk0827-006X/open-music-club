import { Icon, Modal } from '../../shared/react/ui.tsx';
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
      className="user-create-dialog"
      data-user-dialog
      aria-labelledby="user-dialog-title"
    >
      <form data-user-create-form onSubmit={(event) => void onCreateSubmit(event)}>
        <header>
          <span>PERSONAL ARCHIVE</span>
          <button
            type="button"
            data-user-dialog-close
            aria-label="关闭歌单编辑窗口"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <h2 id="user-dialog-title" data-user-dialog-title>
          新建歌单
        </h2>
        <p>保存后，下次登录仍能看到这份声音档案。</p>
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
          <button type="button" data-user-dialog-cancel onClick={onClose}>
            取消
          </button>
          <button type="submit" disabled={busy}>
            <span data-user-dialog-submit>创建歌单</span>{' '}
            <span>
              <Icon name="right" />
            </span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
