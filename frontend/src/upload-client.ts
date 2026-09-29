export type UploadFields = { title: string; artist: string; album?: string }
export type UploadedTrack = {
  source: 'local'
  sourceId: string
  title: string
  coverUrl: string | null
  streamUrl: string
}

type UploadFetcher = (url: string, options?: RequestInit) => Promise<Response>

export class UploadError extends Error {
  readonly status: number

  constructor(message: string, status = 0) {
    super(message)
    this.status = status
  }
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json() } catch { return null }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function uploadFailure(status: number): UploadError {
  if (status === 401) return new UploadError('登录已失效，请重新登录。', status)
  if (status === 403) return new UploadError('安全校验失败，请刷新页面后重试。', status)
  if (status === 413) return new UploadError('音频文件超过服务器允许的大小。', status)
  if (status === 429) return new UploadError('上传过于频繁，请稍后重试。', status)
  if (status === 400) return new UploadError('文件校验未通过，请检查音频格式与内容。', status)
  return new UploadError('上传暂时失败，请稍后重试。', status)
}

export async function uploadMusicFile(
  file: File,
  fields: UploadFields,
  fetcher: UploadFetcher = window.fetch.bind(window),
  signal?: AbortSignal,
): Promise<UploadedTrack> {
  try {
    const tokenResponse = await fetcher('/api/security/csrf-token', { credentials: 'same-origin', signal })
    const tokenBody = await readJson(tokenResponse)
    const csrfToken = isObject(tokenBody) ? tokenBody.csrfToken : null
    if (!tokenResponse.ok) throw uploadFailure(tokenResponse.status)
    if (typeof csrfToken !== 'string' || !csrfToken) throw uploadFailure(403)

    const form = new FormData()
    form.append('file', file)
    form.append('title', fields.title.trim())
    form.append('artist', fields.artist.trim())
    if (fields.album?.trim()) form.append('album', fields.album.trim())

    const response = await fetcher('/api/local/music', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': csrfToken },
      body: form,
      signal,
    })
    if (!response.ok) throw uploadFailure(response.status)
    const body = await readJson(response)
    if (!isObject(body) || body.success !== true || !isObject(body.track) || body.track.source !== 'local') {
      throw new UploadError('上传响应异常，请刷新音乐库确认是否已入库。')
    }
    return body.track as UploadedTrack
  } catch (error) {
    if (error instanceof UploadError || (error instanceof Error && error.name === 'AbortError')) throw error
    throw new UploadError('网络暂时不可用，请检查连接后重试。')
  }
}
