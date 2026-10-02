import { uploadMusicFile, UploadError } from './upload-client.ts'
import { readUploadMetadata } from './upload-metadata.ts'
import { uiIcons } from './ui-icons.ts'

const MAX_PREVIEW_BYTES = 100 * 1024 * 1024
const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'wav', 'm4a', 'ogg'])

export function createUploadPageMarkup() {
  return `<section class="upload-page" data-upload-page hidden inert aria-label="本地音乐入库">
    <div class="upload-heading"><button type="button" data-upload-back>${uiIcons.left}&nbsp; 返回音乐库</button>
      <p>COMMUNITY ARCHIVE / 001</p><h2>UPLOAD <span>/</span> 本地音乐入库</h2>
      <small>将你的音乐加入社区，保存并与更多人分享</small></div>
    <section class="upload-workspace" aria-label="选择音频文件">
      <header class="upload-panel-rail"><span>01&nbsp; UPLOAD</span><span>DRAG &amp; DROP ↗</span></header>
      <div class="upload-dropzone" data-upload-dropzone tabindex="0" role="button" aria-label="选择或拖放音频文件">
        <span class="upload-corner upload-corner--top-left">＋</span><span class="upload-corner upload-corner--top-right">＋</span>
        <div class="upload-file-icon" aria-hidden="true">♫</div><strong>拖放音频文件到此处</strong>
        <button type="button" data-upload-choose>${uiIcons.plus}&nbsp; 选择文件</button>
        <p>支持格式：MP3 · FLAC · WAV · M4A · OGG</p><small>单个文件最大 100 MB</small>
        <span class="upload-corner upload-corner--bottom-left">＋</span><span class="upload-corner upload-corner--bottom-right">＋</span>
      </div>
      <input class="sr-only" type="file" accept=".mp3,.flac,.wav,.m4a,.ogg,audio/*" data-upload-file tabindex="-1" aria-hidden="true" />
      <div class="upload-selected"><header class="upload-panel-rail"><span>02&nbsp; SELECTED FILE</span><span>LOCAL PREVIEW</span></header>
        <div class="upload-selected-row" data-upload-selected-row><span class="upload-selected-icon" aria-hidden="true">♫</span>
          <span class="upload-selected-name"><strong data-upload-filename>尚未选择文件</strong><small data-upload-filesize>选择文件后将在此预览</small></span>
          <span class="upload-selected-progress"><i></i><small data-upload-file-status>等待选择</small></span>
          <button type="button" data-upload-remove aria-label="移除所选文件" disabled>${uiIcons.close}</button></div></div>
    </section>
    <form class="upload-metadata" data-upload-form novalidate><header class="upload-panel-rail"><span>03&nbsp; METADATA</span><span>FILE INFORMATION</span></header>
      <div class="upload-metadata-body"><div class="upload-cover-column"><div class="upload-cover-frame"><img data-upload-cover src="/images/album-placeholder-01.svg" alt="专辑封面预览" /></div>
        <button type="button" data-upload-cover-choose>${uiIcons.plus}&nbsp; 更换封面</button><input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" data-upload-cover-file tabindex="-1" aria-hidden="true" />
        <small class="upload-cover-note">自选封面仅供预览；当前服务保存音频内嵌封面。</small></div>
        <div class="upload-fields"><label>标题 <b>*</b><input type="text" maxlength="120" data-upload-title placeholder="输入歌曲标题" autocomplete="off" /></label>
          <label>歌手 <b>*</b><input type="text" maxlength="120" data-upload-artist placeholder="输入歌手名称" autocomplete="off" /></label>
          <label>专辑<input type="text" maxlength="120" data-upload-album placeholder="未命名专辑" autocomplete="off" /></label></div></div>
      <div class="upload-file-facts"><h3>文件信息</h3><dl>
        <div><dt>格式</dt><dd data-upload-format>—</dd></div><div><dt>音频来源</dt><dd><b>LOCAL</b><small>本地文件上传</small></dd></div>
        <div><dt>时长</dt><dd>上传后识别</dd></div><div><dt>采样率</dt><dd>上传后识别</dd></div>
        <div><dt>文件大小</dt><dd data-upload-size>—</dd></div><div><dt>比特率</dt><dd>上传后识别</dd></div>
      </dl></div>
      <button class="upload-submit" type="submit" data-upload-submit><span>确认上传</span><span>${uiIcons.right}</span></button>
      <p class="upload-feedback" data-upload-feedback role="status" aria-live="polite">选择音频文件后填写资料，再确认上传。</p>
      <p class="upload-safety">◇&nbsp; 服务器会复核文件格式、完整性与元数据。</p>
    </form>
  </section>`
}

export function mountUploadPage(root: HTMLElement) {
  root.innerHTML = createUploadPageMarkup()
  const controller = new AbortController()
  const options = { signal: controller.signal }
  const fileInput = root.querySelector<HTMLInputElement>('[data-upload-file]')!
  const coverInput = root.querySelector<HTMLInputElement>('[data-upload-cover-file]')!
  const dropzone = root.querySelector<HTMLElement>('[data-upload-dropzone]')!
  const feedback = root.querySelector<HTMLElement>('[data-upload-feedback]')!
  const title = root.querySelector<HTMLInputElement>('[data-upload-title]')!
  const artist = root.querySelector<HTMLInputElement>('[data-upload-artist]')!
  const album = root.querySelector<HTMLInputElement>('[data-upload-album]')!
  const cover = root.querySelector<HTMLImageElement>('[data-upload-cover]')!
  let selectedFile: File | null = null
  let coverUrl: string | null = null
  let requestController: AbortController | null = null
  let isSubmitting = false
  let isReadingMetadata = false
  let metadataRequestId = 0

  const setSubmitting = (value: boolean) => {
    isSubmitting = value
    fileInput.disabled = value
    coverInput.disabled = value
    root.querySelector<HTMLButtonElement>('[data-upload-choose]')!.disabled = value
    root.querySelector<HTMLButtonElement>('[data-upload-cover-choose]')!.disabled = value
    root.querySelector<HTMLButtonElement>('[data-upload-remove]')!.disabled = value || !selectedFile
    root.querySelector<HTMLButtonElement>('[data-upload-submit]')!.disabled = value || isReadingMetadata || !selectedFile
    root.querySelector('[data-upload-selected-row]')!.classList.toggle('is-uploading', value)
    root.querySelector('[data-upload-form]')!.setAttribute('aria-busy', String(value))
  }

  const showStatus = (message: string, state: 'neutral' | 'error' | 'ready' = 'neutral') => {
    feedback.textContent = message
    feedback.dataset.state = state
  }

  const clearCover = () => {
    if (coverUrl) URL.revokeObjectURL(coverUrl)
    coverUrl = null
    cover.src = '/images/album-placeholder-01.svg'
    coverInput.value = ''
  }

  const clearFile = () => {
    metadataRequestId += 1
    isReadingMetadata = false
    selectedFile = null
    fileInput.value = ''
    title.value = ''
    artist.value = ''
    album.value = ''
    root.querySelector('[data-upload-filename]')!.textContent = '尚未选择文件'
    root.querySelector('[data-upload-filesize]')!.textContent = '选择文件后将在此预览'
    root.querySelector('[data-upload-file-status]')!.textContent = '等待选择'
    root.querySelector('[data-upload-format]')!.textContent = '—'
    root.querySelector('[data-upload-size]')!.textContent = '—'
    root.querySelector<HTMLButtonElement>('[data-upload-remove]')!.disabled = true
    root.querySelector('[data-upload-selected-row]')!.classList.remove('is-ready')
    clearCover()
    root.querySelector('[data-upload-selected-row]')!.classList.remove('is-uploaded')
    setSubmitting(false)
    showStatus('选择音频文件后填写资料，再确认上传。')
  }

  const selectFile = (file?: File) => {
    if (!file) return
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!AUDIO_EXTENSIONS.has(extension) || file.size > MAX_PREVIEW_BYTES || file.size === 0) {
      fileInput.value = ''
      showStatus('请选择 100 MB 以内的 MP3、FLAC、WAV、M4A 或 OGG 音频文件。', 'error')
      return
    }
    selectedFile = file
    metadataRequestId += 1
    const currentRequestId = metadataRequestId
    isReadingMetadata = true
    root.querySelector('[data-upload-selected-row]')!.classList.remove('is-uploaded')
    clearCover()
    const filenameTitle = file.name.replace(/\.[^.]+$/, '')
    title.value = filenameTitle
    artist.value = ''
    album.value = ''
    const initialValues = { title: title.value, artist: artist.value, album: album.value }
    const size = `${(file.size / 1024 / 1024).toFixed(1)} MB`
    root.querySelector('[data-upload-filename]')!.textContent = file.name
    root.querySelector('[data-upload-filesize]')!.textContent = `${extension.toUpperCase()} / ${size}`
    root.querySelector('[data-upload-file-status]')!.textContent = '本地预览就绪 · 未上传'
    root.querySelector('[data-upload-format]')!.textContent = extension.toUpperCase()
    root.querySelector('[data-upload-size]')!.textContent = size
    root.querySelector<HTMLButtonElement>('[data-upload-remove]')!.disabled = false
    root.querySelector('[data-upload-selected-row]')!.classList.add('is-ready')
    setSubmitting(false)
    showStatus('正在读取音频内嵌的歌曲资料…')
    void readUploadMetadata(file).then((metadata) => {
      if (currentRequestId !== metadataRequestId) return
      if (metadata.title && title.value === initialValues.title) {
        title.value = metadata.title
      }
      if (metadata.artist && artist.value === initialValues.artist) {
        artist.value = metadata.artist
      }
      if (metadata.album && album.value === initialValues.album) {
        album.value = metadata.album
      }
      if (metadata.cover && !coverInput.files?.length) {
        coverUrl = URL.createObjectURL(metadata.cover)
        cover.src = coverUrl
      }
      showStatus(metadata.title || metadata.artist || metadata.album || metadata.cover
        ? '已读取音频内嵌资料；请核对后上传。'
        : '未找到可用标签；请手动核对标题和歌手。', 'ready')
    }).finally(() => {
      if (currentRequestId !== metadataRequestId) return
      isReadingMetadata = false
      setSubmitting(false)
    })
  }

  root.querySelector('[data-upload-choose]')!.addEventListener('click', () => fileInput.click(), options)
  dropzone.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-upload-choose]')) fileInput.click()
  }, options)
  dropzone.addEventListener('keydown', (event) => {
    if (event.target !== dropzone) return
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click() }
  }, options)
  fileInput.addEventListener('change', () => selectFile(fileInput.files?.[0]), options)
  root.querySelector('[data-upload-remove]')!.addEventListener('click', clearFile, options)

  dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('is-dragging') }, options)
  dropzone.addEventListener('dragleave', (event) => {
    if (!dropzone.contains(event.relatedTarget as Node)) dropzone.classList.remove('is-dragging')
  }, options)
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault()
    dropzone.classList.remove('is-dragging')
    selectFile(event.dataTransfer?.files[0])
  }, options)

  root.querySelector('[data-upload-cover-choose]')!.addEventListener('click', () => coverInput.click(), options)
  coverInput.addEventListener('change', () => {
    const file = coverInput.files?.[0]
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      showStatus('封面预览只支持 10 MB 以内的 JPEG、PNG 或 WebP 图片。', 'error')
      coverInput.value = ''
      return
    }
    if (coverUrl) URL.revokeObjectURL(coverUrl)
    coverUrl = URL.createObjectURL(file)
    cover.src = coverUrl
    showStatus('封面仅在本机预览；服务器只保存音频内嵌封面。', 'ready')
  }, options)

  root.querySelector('[data-upload-form]')!.addEventListener('submit', (event) => {
    event.preventDefault()
    if (isSubmitting || isReadingMetadata) return
    if (!selectedFile) showStatus('请先选择音频文件。', 'error')
    else if (!title.value.trim() || !artist.value.trim()) showStatus('请填写标题和歌手后再继续。', 'error')
    else {
      const file = selectedFile
      requestController = new AbortController()
      setSubmitting(true)
      root.querySelector('[data-upload-file-status]')!.textContent = '正在由服务器验证并保存…'
      showStatus('正在上传，请保持页面打开。')
      void uploadMusicFile(file, { title: title.value, artist: artist.value, album: album.value }, undefined, requestController.signal)
        .then((track) => {
          selectedFile = null
          fileInput.value = ''
          if (coverUrl) URL.revokeObjectURL(coverUrl)
          coverUrl = null
          cover.src = track.coverUrl || '/images/album-placeholder-01.svg'
          root.querySelector('[data-upload-selected-row]')!.classList.add('is-uploaded')
          root.querySelector('[data-upload-file-status]')!.textContent = '已安全入库'
          showStatus('上传成功，已加入社区音乐库。可在搜索页查看。', 'ready')
        }).catch((error: unknown) => {
          if (error instanceof Error && error.name === 'AbortError') return
          root.querySelector('[data-upload-file-status]')!.textContent = '上传未完成'
          showStatus(error instanceof UploadError ? error.message : '上传暂时失败，请稍后重试。', 'error')
        }).finally(() => { requestController = null; setSubmitting(false) })
    }
  }, options)

  return { destroy: () => { metadataRequestId += 1; controller.abort(); requestController?.abort(); clearCover() } }
}
