import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, FormEvent } from 'react';
import { FALLBACK_COVER } from '../../shared/music.ts';
import { useLatest } from '../../shared/react/hooks.ts';
import { uploadMusicFile, UploadError } from '../../services/music/upload.ts';
import { readUploadMetadata } from './metadata.ts';

const MAX_PREVIEW_BYTES = 100 * 1024 * 1024;
const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'wav', 'm4a', 'ogg']);
type StatusState = 'neutral' | 'error' | 'ready';

export function useMusicUpload(onUploaded?: () => void) {
  const onUploadedRef = useLatest(onUploaded);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const unmountedRef = useRef(false);
  const metadataRequestIdRef = useRef(0);
  const readingMetadataRef = useRef(false);
  const submittingRef = useRef(false);
  const titleDirtyRef = useRef(false);
  const artistDirtyRef = useRef(false);
  const albumDirtyRef = useRef(false);
  const coverObjectUrlRef = useRef<string | null>(null);
  const coverFileSelectedRef = useRef(false);
  const requestControllerRef = useRef<AbortController | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmittingState] = useState(false);
  const [isReadingMetadata, setIsReadingMetadata] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isUploaded, setIsUploaded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [coverPreview, setCoverPreview] = useState(FALLBACK_COVER);
  const [filename, setFilename] = useState('尚未选择文件');
  const [filesize, setFilesize] = useState('选择文件后将在此预览');
  const [fileStatus, setFileStatus] = useState('等待选择');
  const [format, setFormat] = useState('—');
  const [size, setSize] = useState('—');
  const [feedback, setFeedback] = useState<{ message: string; state?: StatusState }>({
    message: '选择音频文件后填写资料，再确认上传。',
  });

  function setSubmitting(value: boolean) {
    submittingRef.current = value;
    setIsSubmittingState(value);
  }

  function showStatus(message: string, state: StatusState = 'neutral') {
    if (!unmountedRef.current) setFeedback({ message, state });
  }

  function releaseCoverObjectUrl() {
    if (coverObjectUrlRef.current) {
      URL.revokeObjectURL(coverObjectUrlRef.current);
      coverObjectUrlRef.current = null;
    }
  }

  function clearCover() {
    releaseCoverObjectUrl();
    coverFileSelectedRef.current = false;
    setCoverPreview(FALLBACK_COVER);
    if (coverInputRef.current) coverInputRef.current.value = '';
  }

  function showCoverObject(blob: Blob) {
    releaseCoverObjectUrl();
    const url = URL.createObjectURL(blob);
    coverObjectUrlRef.current = url;
    setCoverPreview(url);
  }

  function clearFile() {
    // 上传中不允许移除/替换，避免旧上传响应落到新文件上。
    if (submittingRef.current) return;
    metadataRequestIdRef.current += 1;
    readingMetadataRef.current = false;
    setIsReadingMetadata(false);
    titleDirtyRef.current = false;
    artistDirtyRef.current = false;
    albumDirtyRef.current = false;
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setTitle('');
    setArtist('');
    setAlbum('');
    setFilename('尚未选择文件');
    setFilesize('选择文件后将在此预览');
    setFileStatus('等待选择');
    setFormat('—');
    setSize('—');
    setIsReady(false);
    clearCover();
    setIsUploaded(false);
    setSubmitting(false);
    showStatus('选择音频文件后填写资料，再确认上传。');
  }

  function selectFile(file?: File) {
    // 上传请求进行中不接受新文件，防止旧上传成功/失败后清空或覆盖新选择。
    if (!file || submittingRef.current) return;
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!AUDIO_EXTENSIONS.has(extension) || file.size > MAX_PREVIEW_BYTES || file.size === 0) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      showStatus('请选择 100 MB 以内的 MP3、FLAC、WAV、M4A 或 OGG 音频文件。', 'error');
      return;
    }

    setSelectedFile(file);
    metadataRequestIdRef.current += 1;
    const currentRequestId = metadataRequestIdRef.current;
    readingMetadataRef.current = true;
    setIsReadingMetadata(true);
    setIsUploaded(false);
    clearCover();
    const filenameTitle = file.name.replace(/\.[^.]+$/, '');
    setTitle(filenameTitle);
    setArtist('');
    setAlbum('');
    titleDirtyRef.current = false;
    artistDirtyRef.current = false;
    albumDirtyRef.current = false;
    const sizeText = `${(file.size / 1024 / 1024).toFixed(1)} MB`;
    setFilename(file.name);
    setFilesize(`${extension.toUpperCase()} / ${sizeText}`);
    setFileStatus('本地预览就绪 · 未上传');
    setFormat(extension.toUpperCase());
    setSize(sizeText);
    setIsReady(true);
    showStatus('正在读取音频内嵌的歌曲资料…');

    void readUploadMetadata(file)
      .then((metadata) => {
        if (currentRequestId !== metadataRequestIdRef.current || unmountedRef.current) return;
        // 用户已主动编辑的字段一律保留，解析结果只补全未动过的自动填充值。
        if (metadata.title && !titleDirtyRef.current) setTitle(metadata.title);
        if (metadata.artist && !artistDirtyRef.current) setArtist(metadata.artist);
        if (metadata.album && !albumDirtyRef.current) setAlbum(metadata.album);
        if (metadata.cover && !coverFileSelectedRef.current) showCoverObject(metadata.cover);
        showStatus(
          metadata.title || metadata.artist || metadata.album || metadata.cover
            ? '已读取音频内嵌资料；请核对后上传。'
            : '未找到可用标签；请手动核对标题和歌手。',
          'ready',
        );
      })
      .finally(() => {
        if (currentRequestId !== metadataRequestIdRef.current || unmountedRef.current) return;
        readingMetadataRef.current = false;
        setIsReadingMetadata(false);
      });
  }

  function onCoverChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      showStatus('封面预览只支持 10 MB 以内的 JPEG、PNG 或 WebP 图片。', 'error');
      input.value = '';
      return;
    }
    coverFileSelectedRef.current = true;
    showCoverObject(file);
    showStatus('封面仅在本机预览；服务器只保存音频内嵌封面。', 'ready');
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || readingMetadataRef.current) return;
    if (!selectedFile) {
      showStatus('请先选择音频文件。', 'error');
      return;
    }
    if (!title.trim() || !artist.trim()) {
      showStatus('请填写标题和歌手后再继续。', 'error');
      return;
    }
    const file = selectedFile;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setSubmitting(true);
    setFileStatus('正在由服务器验证并保存…');
    showStatus('正在上传，请保持页面打开。');
    void uploadMusicFile(file, { title, artist, album }, undefined, controller.signal)
      .then((track) => {
        if (unmountedRef.current || controller.signal.aborted) return;
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        // 上传成功后把本机预览换为服务器封面。
        releaseCoverObjectUrl();
        setCoverPreview(track.coverUrl || FALLBACK_COVER);
        setIsUploaded(true);
        setFileStatus('已安全入库');
        showStatus('上传成功，已加入我的上传。', 'ready');
        onUploadedRef.current?.();
      })
      .catch((error: unknown) => {
        if (unmountedRef.current || controller.signal.aborted) return;
        if (error instanceof Error && error.name === 'AbortError') return;
        setFileStatus('上传未完成');
        showStatus(
          error instanceof UploadError ? error.message : '上传暂时失败，请稍后重试。',
          'error',
        );
      })
      .finally(() => {
        if (requestControllerRef.current === controller) requestControllerRef.current = null;
        if (!unmountedRef.current && !controller.signal.aborted) setSubmitting(false);
      });
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer?.files[0]);
  }

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      // 卸载时让元数据读取失效、终止上传，并释放本机封面 ObjectURL。
      unmountedRef.current = true;
      metadataRequestIdRef.current += 1;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      releaseCoverObjectUrl();
    };
  }, []);

  return {
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
    changeTitle(value: string) {
      titleDirtyRef.current = true;
      setTitle(value);
    },
    changeArtist(value: string) {
      artistDirtyRef.current = true;
      setArtist(value);
    },
    changeAlbum(value: string) {
      albumDirtyRef.current = true;
      setAlbum(value);
    },
  };
}
