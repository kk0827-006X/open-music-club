import { useEffect } from 'react';
import { Modal, ModalAction } from '../../shared/react/ui.tsx';

export function AvatarSaveDialog({
  open,
  busy,
  name,
  onName,
  onClose,
  onSave,
  onDialogChange,
}: {
  open: boolean;
  busy: boolean;
  name: string;
  onName: (name: string) => void;
  onClose: () => void;
  onSave: () => void;
  onDialogChange?: (open: boolean) => void;
}) {
  useEffect(() => {
    onDialogChange?.(open);
    return () => onDialogChange?.(false);
  }, [open, onDialogChange]);
  return (
    <Modal
      open={open}
      busy={busy}
      onClose={onClose}
      className="modal-card avatar-source-dialog"
      aria-labelledby="avatar-save-title"
    >
      <form
        className="avatar-save"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <h3 id="avatar-save-title">保存形象</h3>
        <label className="field">
          <span>形象名称</span>
          <input
            aria-label="形象名称"
            value={name}
            maxLength={40}
            autoComplete="off"
            disabled={busy}
            onChange={(event) => onName(event.target.value)}
          />
        </label>
        <div className="modal-actions">
          <ModalAction variant="cancel" disabled={busy} onClick={onClose}>
            取消
          </ModalAction>
          <ModalAction type="submit" disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </ModalAction>
        </div>
      </form>
    </Modal>
  );
}
