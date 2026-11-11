import type { FocusEvent, KeyboardEvent, Ref } from 'react';
import { Icon } from '../../shared/react/ui.tsx';
import type { UserPlaylist } from '../../services/music/personal-library.ts';

export interface PlaylistHeaderProps {
  list: Pick<UserPlaylist, 'id' | 'name'>;
  playable: boolean;
  disabled?: boolean;
  renaming?: boolean;
  renameValue?: string;
  renameInputRef?: Ref<HTMLInputElement>;
  onBack?: () => void;
  onStartRename?: () => void;
  onRenameValueChange?: (value: string) => void;
  onRenameSubmit?: () => void;
  onRenameKeyDown?: (event: KeyboardEvent<HTMLFormElement>) => void;
  onRenameBlur?: (event: FocusEvent<HTMLFormElement>) => void;
  onPlay?: () => void;
  onDelete?: () => void;
}

export function PlaylistHeader({
  list,
  playable,
  disabled = false,
  renaming = false,
  renameValue,
  renameInputRef,
  onBack,
  onStartRename,
  onRenameValueChange,
  onRenameSubmit,
  onRenameKeyDown,
  onRenameBlur,
  onPlay,
  onDelete,
}: PlaylistHeaderProps) {
  return (
    <div className="user-real-list-header">
      <button
        type="button"
        className="user-back"
        data-user-back
        disabled={disabled}
        onClick={onBack}
      >
        <Icon name="left" /> 返回歌单
      </button>
      <div className="user-playlist-name-wrap">
        <h3>
          <button
            type="button"
            className="user-playlist-name"
            data-user-rename={list.id}
            title="点击修改歌单名称"
            hidden={renaming}
            disabled={disabled}
            onClick={onStartRename}
          >
            {list.name}
          </button>
        </h3>
        <form
          className="user-rename-form"
          data-user-rename-form={list.id}
          hidden={!renaming}
          onSubmit={(event) => {
            event.preventDefault();
            onRenameSubmit?.();
          }}
          onKeyDown={onRenameKeyDown}
          onBlur={onRenameBlur}
        >
          <input
            ref={renameInputRef}
            name="name"
            aria-label="歌单名称"
            maxLength={100}
            required
            value={renameValue ?? list.name}
            onChange={(event) => onRenameValueChange?.(event.currentTarget.value)}
          />
          <button className="sr-only" type="submit" disabled={disabled}>
            保存歌单名称
          </button>
        </form>
      </div>
      <div className="user-list-detail-actions">
        <button
          type="button"
          className="user-icon-button user-play-button"
          data-user-playlist-play
          aria-label="播放歌单"
          title="播放歌单"
          disabled={!playable || disabled}
          onClick={onPlay}
        >
          <Icon name="play" />
        </button>
        <button
          type="button"
          className="user-icon-button user-remove-button"
          data-user-delete={list.id}
          aria-label="删除歌单"
          title="删除歌单"
          disabled={disabled}
          onClick={onDelete}
        >
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
}
