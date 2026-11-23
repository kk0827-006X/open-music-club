import { useLayoutEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Icon } from '../../shared/react/ui.tsx';
import { usePageMotion } from '../../shared/react/page-transitions.ts';
import { useMusicUpload } from './use-music-upload.ts';

export default function UploadMusicForm({
  active,
  onBack,
  onUploaded,
}: {
  active: boolean;
  onBack?(): void;
  onUploaded?(): void;
}) {
  const {
    fileInputRef,
    coverInputRef,
    selectedFile,
    isSubmitting,
    isReadingMetadata,
    isReady,
    isUploaded,
    isDragging,
    setIsDragging,
    title,
    artist,
    album,
    coverPreview,
    filename,
    filesize,
    fileStatus,
    format,
    size,
    feedback,
    selectFile,
    clearFile,
    onDrop,
    onCoverChange,
    onSubmit,
    changeTitle,
    changeArtist,
    changeAlbum,
  } = useMusicUpload(onUploaded);
  const metadataMotion = usePageMotion(selectedFile !== null);
  const panel = useRef<HTMLElement>(null);
  const titleElement = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    if (!active || !panel.current) return;
    panel.current.scrollTop = 0;
    titleElement.current?.focus({ preventScroll: true });
  }, [active]);

  return (
    <section
      ref={panel}
      className="user-upload-form"
      data-user-upload-form
      hidden={!active}
      inert={!active}
      aria-labelledby="user-upload-form-title"
    >
      <header className="user-upload-heading">
        <button type="button" className="user-back" data-upload-back onClick={onBack}>
          <Icon name="left" /> 返回我的上传
        </button>
        <h2 id="user-upload-form-title" ref={titleElement} tabIndex={-1}>
          上传音乐
        </h2>
      </header>
      <div className="user-upload-layout">
        <section className="upload-workspace" aria-label="选择音频文件">
          <header className="upload-panel-rail">
            <span>选择音频</span>
          </header>
          <div
            className={`upload-dropzone${isDragging ? ' is-dragging' : ''}`}
            data-upload-dropzone
            tabIndex={0}
            role="button"
            aria-label="选择或拖放音频文件"
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest('[data-upload-choose]'))
                return;
              fileInputRef.current?.click();
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                event.currentTarget.contains(event.relatedTarget)
              )
                return;
              setIsDragging(false);
            }}
            onDrop={onDrop}
          >
            <span className="upload-corner upload-corner--top-left">＋</span>
            <span className="upload-corner upload-corner--top-right">＋</span>
            <div className="upload-file-icon" aria-hidden="true">
              ♫
            </div>
            <strong>拖放音频文件到此处</strong>
            <button
              type="button"
              data-upload-choose
              disabled={isSubmitting}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="plus" />
              &nbsp; 选择文件
            </button>
            <p>支持格式：MP3 · FLAC · WAV · M4A · OGG</p>
            <small>单个文件最大 100 MB</small>
            <span className="upload-corner upload-corner--bottom-left">＋</span>
            <span className="upload-corner upload-corner--bottom-right">＋</span>
          </div>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept=".mp3,.flac,.wav,.m4a,.ogg,audio/*"
            data-upload-file
            tabIndex={-1}
            aria-hidden="true"
            disabled={isSubmitting}
            onChange={(event) => selectFile(event.currentTarget.files?.[0])}
          />
          <div className="upload-selected">
            <header className="upload-panel-rail">
              <span>已选文件</span>
            </header>
            <div
              className={`upload-selected-row${isReady ? ' is-ready' : ''}${isUploaded ? ' is-uploaded' : ''}${isSubmitting ? ' is-uploading' : ''}`}
              data-upload-selected-row
            >
              <span className="upload-selected-icon" aria-hidden="true">
                ♫
              </span>
              <span className="upload-selected-name">
                <strong data-upload-filename>{filename}</strong>
                <small data-upload-filesize>{filesize}</small>
              </span>
              <span className="upload-selected-progress">
                <i></i>
                <small data-upload-file-status>{fileStatus}</small>
              </span>
              <button
                type="button"
                data-upload-remove
                aria-label="移除所选文件"
                disabled={isSubmitting || !selectedFile}
                onClick={clearFile}
              >
                <Icon name="close" />
              </button>
            </div>
            <p
              className="upload-feedback"
              data-upload-feedback
              role="status"
              aria-live="polite"
              data-state={feedback.state}
            >
              {feedback.message}
            </p>
          </div>
        </section>
        <motion.form
          className="upload-metadata"
          data-upload-form
          noValidate
          aria-busy={isSubmitting}
          onSubmit={onSubmit}
          {...metadataMotion}
        >
          <header className="upload-panel-rail">
            <span>歌曲资料</span>
          </header>
          <div className="upload-metadata-body">
            <div className="upload-cover-column">
              <div className="upload-cover-frame">
                <img data-upload-cover src={coverPreview} alt="专辑封面预览" />
              </div>
              <button
                type="button"
                data-upload-cover-choose
                disabled={isSubmitting}
                onClick={() => coverInputRef.current?.click()}
              >
                <Icon name="plus" />
                &nbsp; 更换封面
              </button>
              <input
                ref={coverInputRef}
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                data-upload-cover-file
                tabIndex={-1}
                aria-hidden="true"
                disabled={isSubmitting}
                onChange={onCoverChange}
              />
              <small className="upload-cover-note">
                自选封面仅供预览；当前服务保存音频内嵌封面。
              </small>
            </div>
            <div className="upload-fields">
              <label>
                标题 <b>*</b>
                <input
                  type="text"
                  maxLength={120}
                  data-upload-title
                  placeholder="输入歌曲标题"
                  autoComplete="off"
                  value={title}
                  onChange={(event) => changeTitle(event.currentTarget.value)}
                />
              </label>
              <label>
                歌手 <b>*</b>
                <input
                  type="text"
                  maxLength={120}
                  data-upload-artist
                  placeholder="输入歌手名称"
                  autoComplete="off"
                  value={artist}
                  onChange={(event) => changeArtist(event.currentTarget.value)}
                />
              </label>
              <label>
                专辑
                <input
                  type="text"
                  maxLength={120}
                  data-upload-album
                  placeholder="未命名专辑"
                  autoComplete="off"
                  value={album}
                  onChange={(event) => changeAlbum(event.currentTarget.value)}
                />
              </label>
            </div>
          </div>
          <div className="upload-file-facts">
            <h3>文件信息</h3>
            <dl>
              <div>
                <dt>格式</dt>
                <dd data-upload-format>{format}</dd>
              </div>
              <div>
                <dt>音频来源</dt>
                <dd>
                  <b>LOCAL</b>
                  <small>本地文件上传</small>
                </dd>
              </div>
              <div>
                <dt>时长</dt>
                <dd>上传后识别</dd>
              </div>
              <div>
                <dt>采样率</dt>
                <dd>上传后识别</dd>
              </div>
              <div>
                <dt>文件大小</dt>
                <dd data-upload-size>{size}</dd>
              </div>
              <div>
                <dt>比特率</dt>
                <dd>上传后识别</dd>
              </div>
            </dl>
          </div>
          <button
            className="upload-submit"
            type="submit"
            data-upload-submit
            disabled={isSubmitting || isReadingMetadata || !selectedFile}
          >
            <span>确认上传</span>
            <span>
              <Icon name="right" />
            </span>
          </button>
          <p className="upload-safety">◇&nbsp; 服务器会复核文件格式、完整性与元数据。</p>
        </motion.form>
      </div>
    </section>
  );
}
