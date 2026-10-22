import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, FormEvent } from 'react'
import { motion } from 'motion/react'
import { Icon } from '../../shared/react/ui.tsx'
import { usePageVisibility, useReducedMotion } from '../../shared/react/hooks.ts'
import { uploadMusicFile, UploadError } from '../../services/music/upload.ts'
import { readUploadMetadata } from './metadata.ts'

const MAX_PREVIEW_BYTES = 100 * 1024 * 1024
const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'wav', 'm4a', 'ogg'])
const FALLBACK_COVER = '/images/album-placeholder-01.svg'
type StatusState = 'neutral' | 'error' | 'ready'

export interface UploadPageProps {
  active: boolean
}

export interface UploadPageHandle {
  readonly hasOpenDialog: boolean
}

export const UploadPage = forwardRef<UploadPageHandle, UploadPageProps>(function UploadPage({ active }, ref) {
  const reduced = useReducedMotion()
  // active=false 立即 inert；hidden 延迟到淡出结束，避免吞掉退出动画。
  const visible = usePageVisibility(active, 300)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const unmountedRef = useRef(false)
  const metadataRequestIdRef = useRef(0)
  const readingMetadataRef = useRef(false)
  const submittingRef = useRef(false)
  const titleDirtyRef = useRef(false)
  const artistDirtyRef = useRef(false)
  const albumDirtyRef = useRef(false)
  const coverObjectUrlRef = useRef<string | null>(null)
  const coverFileSelectedRef = useRef(false)
  const requestControllerRef = useRef<AbortController | null>(null)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isSubmitting, setIsSubmittingState] = useState(false)
  const [isReadingMetadata, setIsReadingMetadata] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [isUploaded, setIsUploaded] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [album, setAlbum] = useState('')
  const [coverPreview, setCoverPreview] = useState(FALLBACK_COVER)
  const [filename, setFilename] = useState('尚未选择文件')
  const [filesize, setFilesize] = useState('选择文件后将在此预览')
  const [fileStatus, setFileStatus] = useState('等待选择')
  const [format, setFormat] = useState('—')
  const [size, setSize] = useState('—')
  const [feedback, setFeedback] = useState<{ message: string; state?: StatusState }>({
    message: '选择音频文件后填写资料，再确认上传。',
  })

  function setSubmitting(value: boolean) {
    submittingRef.current = value
    setIsSubmittingState(value)
  }

  function showStatus(message: string, state: StatusState = 'neutral') {
    if (!unmountedRef.current) setFeedback({ message, state })
  }

  function releaseCoverObjectUrl() {
    if (coverObjectUrlRef.current) {
      URL.revokeObjectURL(coverObjectUrlRef.current)
      coverObjectUrlRef.current = null
    }
  }

  function clearCover() {
    releaseCoverObjectUrl()
    coverFileSelectedRef.current = false
    setCoverPreview(FALLBACK_COVER)
    if (coverInputRef.current) coverInputRef.current.value = ''
  }

  function showCoverObject(blob: Blob) {
    releaseCoverObjectUrl()
    const url = URL.createObjectURL(blob)
    coverObjectUrlRef.current = url
    setCoverPreview(url)
  }

  function clearFile() {
    // 上传中不允许移除/替换，避免旧上传响应落到新文件上。
    if (submittingRef.current) return
    metadataRequestIdRef.current += 1
    readingMetadataRef.current = false
    setIsReadingMetadata(false)
    titleDirtyRef.current = false
    artistDirtyRef.current = false
    albumDirtyRef.current = false
    setSelectedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setTitle('')
    setArtist('')
    setAlbum('')
    setFilename('尚未选择文件')
    setFilesize('选择文件后将在此预览')
    setFileStatus('等待选择')
    setFormat('—')
    setSize('—')
    setIsReady(false)
    clearCover()
    setIsUploaded(false)
    setSubmitting(false)
    showStatus('选择音频文件后填写资料，再确认上传。')
  }

  function selectFile(file?: File) {
    // 上传请求进行中不接受新文件，防止旧上传成功/失败后清空或覆盖新选择。
    if (!file || submittingRef.current) return
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!AUDIO_EXTENSIONS.has(extension) || file.size > MAX_PREVIEW_BYTES || file.size === 0) {
      if (fileInputRef.current) fileInputRef.current.value = ''
      showStatus('请选择 100 MB 以内的 MP3、FLAC、WAV、M4A 或 OGG 音频文件。', 'error')
      return
    }

    setSelectedFile(file)
    metadataRequestIdRef.current += 1
    const currentRequestId = metadataRequestIdRef.current
    readingMetadataRef.current = true
    setIsReadingMetadata(true)
    setIsUploaded(false)
    clearCover()
    const filenameTitle = file.name.replace(/\.[^.]+$/, '')
    setTitle(filenameTitle)
    setArtist('')
    setAlbum('')
    titleDirtyRef.current = false
    artistDirtyRef.current = false
    albumDirtyRef.current = false
    const sizeText = `${(file.size / 1024 / 1024).toFixed(1)} MB`
    setFilename(file.name)
    setFilesize(`${extension.toUpperCase()} / ${sizeText}`)
    setFileStatus('本地预览就绪 · 未上传')
    setFormat(extension.toUpperCase())
    setSize(sizeText)
    setIsReady(true)
    showStatus('正在读取音频内嵌的歌曲资料…')

    void readUploadMetadata(file).then((metadata) => {
      if (currentRequestId !== metadataRequestIdRef.current || unmountedRef.current) return
      // 用户已主动编辑的字段一律保留，解析结果只补全未动过的自动填充值。
      if (metadata.title && !titleDirtyRef.current) setTitle(metadata.title)
      if (metadata.artist && !artistDirtyRef.current) setArtist(metadata.artist)
      if (metadata.album && !albumDirtyRef.current) setAlbum(metadata.album)
      if (metadata.cover && !coverFileSelectedRef.current) showCoverObject(metadata.cover)
      showStatus(metadata.title || metadata.artist || metadata.album || metadata.cover
        ? '已读取音频内嵌资料；请核对后上传。'
        : '未找到可用标签；请手动核对标题和歌手。', 'ready')
    }).finally(() => {
      if (currentRequestId !== metadataRequestIdRef.current || unmountedRef.current) return
      readingMetadataRef.current = false
      setIsReadingMetadata(false)
    })
  }

  function onCoverChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      showStatus('封面预览只支持 10 MB 以内的 JPEG、PNG 或 WebP 图片。', 'error')
      input.value = ''
      return
    }
    coverFileSelectedRef.current = true
    showCoverObject(file)
    showStatus('封面仅在本机预览；服务器只保存音频内嵌封面。', 'ready')
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current || readingMetadataRef.current) return
    if (!selectedFile) {
      showStatus('请先选择音频文件。', 'error')
      return
    }
    if (!title.trim() || !artist.trim()) {
      showStatus('请填写标题和歌手后再继续。', 'error')
      return
    }
    const file = selectedFile
    const controller = new AbortController()
    requestControllerRef.current = controller
    setSubmitting(true)
    setFileStatus('正在由服务器验证并保存…')
    showStatus('正在上传，请保持页面打开。')
    void uploadMusicFile(file, { title, artist, album }, undefined, controller.signal).then((track) => {
      if (unmountedRef.current || controller.signal.aborted) return
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      // 旧页上传成功后只释放本机封面 URL 并切换到服务器封面，不重置封面选择框。
      releaseCoverObjectUrl()
      setCoverPreview(track.coverUrl || FALLBACK_COVER)
      setIsUploaded(true)
      setFileStatus('已安全入库')
      showStatus('上传成功，已加入社区音乐库。可在搜索页查看。', 'ready')
    }).catch((error: unknown) => {
      if (unmountedRef.current || controller.signal.aborted) return
      if (error instanceof Error && error.name === 'AbortError') return
      setFileStatus('上传未完成')
      showStatus(error instanceof UploadError ? error.message : '上传暂时失败，请稍后重试。', 'error')
    }).finally(() => {
      if (requestControllerRef.current === controller) requestControllerRef.current = null
      if (!unmountedRef.current && !controller.signal.aborted) setSubmitting(false)
    })
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)
    selectFile(event.dataTransfer?.files[0])
  }

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      // 卸载时让元数据读取失效、终止上传，并释放本机封面 ObjectURL。
      unmountedRef.current = true
      metadataRequestIdRef.current += 1
      requestControllerRef.current?.abort()
      requestControllerRef.current = null
      releaseCoverObjectUrl()
    }
  }, [])

  useImperativeHandle(ref, () => ({ hasOpenDialog: false }), [])

  return (
    <motion.section
      className="upload-page"
      data-upload-page
      hidden={!visible}
      inert={!active}
      aria-label="本地音乐入库"
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
      transition={reduced ? { duration: 0 } : { duration: 0.3, ease: [0.2, 0.7, 0.2, 1] as [number, number, number, number] }}
    >
      <div className="upload-heading">
        <button type="button" data-upload-back><Icon name="left" />&nbsp; 返回音乐库</button>
        <p>COMMUNITY ARCHIVE / 001</p><h2>UPLOAD <span>/</span> 本地音乐入库</h2>
        <small>将你的音乐加入社区，保存并与更多人分享</small>
      </div>
      <section className="upload-workspace" aria-label="选择音频文件">
        <header className="upload-panel-rail"><span>01&nbsp; UPLOAD</span><span>DRAG &amp; DROP ↗</span></header>
        <div
          className={`upload-dropzone${isDragging ? ' is-dragging' : ''}`}
          data-upload-dropzone
          tabIndex={0}
          role="button"
          aria-label="选择或拖放音频文件"
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('[data-upload-choose]')) return
            fileInputRef.current?.click()
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              fileInputRef.current?.click()
            }
          }}
          onDragOver={(event) => { event.preventDefault(); setIsDragging(true) }}
          onDragLeave={(event) => {
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
            setIsDragging(false)
          }}
          onDrop={onDrop}
        >
          <span className="upload-corner upload-corner--top-left">＋</span><span className="upload-corner upload-corner--top-right">＋</span>
          <div className="upload-file-icon" aria-hidden="true">♫</div><strong>拖放音频文件到此处</strong>
          <button type="button" data-upload-choose disabled={isSubmitting} onClick={() => fileInputRef.current?.click()}><Icon name="plus" />&nbsp; 选择文件</button>
          <p>支持格式：MP3 · FLAC · WAV · M4A · OGG</p><small>单个文件最大 100 MB</small>
          <span className="upload-corner upload-corner--bottom-left">＋</span><span className="upload-corner upload-corner--bottom-right">＋</span>
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
          <header className="upload-panel-rail"><span>02&nbsp; SELECTED FILE</span><span>LOCAL PREVIEW</span></header>
          <div className={`upload-selected-row${isReady ? ' is-ready' : ''}${isUploaded ? ' is-uploaded' : ''}${isSubmitting ? ' is-uploading' : ''}`} data-upload-selected-row>
            <span className="upload-selected-icon" aria-hidden="true">♫</span>
            <span className="upload-selected-name"><strong data-upload-filename>{filename}</strong><small data-upload-filesize>{filesize}</small></span>
            <span className="upload-selected-progress"><i></i><small data-upload-file-status>{fileStatus}</small></span>
            <button type="button" data-upload-remove aria-label="移除所选文件" disabled={isSubmitting || !selectedFile} onClick={clearFile}><Icon name="close" /></button>
          </div>
        </div>
      </section>
      <form className="upload-metadata" data-upload-form noValidate aria-busy={isSubmitting} onSubmit={onSubmit}>
        <header className="upload-panel-rail"><span>03&nbsp; METADATA</span><span>FILE INFORMATION</span></header>
        <div className="upload-metadata-body">
          <div className="upload-cover-column">
            <div className="upload-cover-frame"><img data-upload-cover src={coverPreview} alt="专辑封面预览" /></div>
            <button type="button" data-upload-cover-choose disabled={isSubmitting} onClick={() => coverInputRef.current?.click()}><Icon name="plus" />&nbsp; 更换封面</button>
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
            <small className="upload-cover-note">自选封面仅供预览；当前服务保存音频内嵌封面。</small>
          </div>
          <div className="upload-fields">
            <label>标题 <b>*</b><input type="text" maxLength={120} data-upload-title placeholder="输入歌曲标题" autoComplete="off" value={title} onChange={(event) => { titleDirtyRef.current = true; setTitle(event.currentTarget.value) }} /></label>
            <label>歌手 <b>*</b><input type="text" maxLength={120} data-upload-artist placeholder="输入歌手名称" autoComplete="off" value={artist} onChange={(event) => { artistDirtyRef.current = true; setArtist(event.currentTarget.value) }} /></label>
            <label>专辑<input type="text" maxLength={120} data-upload-album placeholder="未命名专辑" autoComplete="off" value={album} onChange={(event) => { albumDirtyRef.current = true; setAlbum(event.currentTarget.value) }} /></label>
          </div>
        </div>
        <div className="upload-file-facts"><h3>文件信息</h3><dl>
          <div><dt>格式</dt><dd data-upload-format>{format}</dd></div><div><dt>音频来源</dt><dd><b>LOCAL</b><small>本地文件上传</small></dd></div>
          <div><dt>时长</dt><dd>上传后识别</dd></div><div><dt>采样率</dt><dd>上传后识别</dd></div>
          <div><dt>文件大小</dt><dd data-upload-size>{size}</dd></div><div><dt>比特率</dt><dd>上传后识别</dd></div>
        </dl></div>
        <button className="upload-submit" type="submit" data-upload-submit disabled={isSubmitting || isReadingMetadata || !selectedFile}><span>确认上传</span><span><Icon name="right" /></span></button>
        <p className="upload-feedback" data-upload-feedback role="status" aria-live="polite" data-state={feedback.state}>{feedback.message}</p>
        <p className="upload-safety">◇&nbsp; 服务器会复核文件格式、完整性与元数据。</p>
      </form>
    </motion.section>
  )
})

export default UploadPage
