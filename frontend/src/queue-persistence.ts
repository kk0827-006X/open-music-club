import type { SearchItem } from './music-search.ts'
import type { TrackReference } from './personal-library-client.ts'

type QueuePersistenceOptions = {
  read(): readonly SearchItem[]
  restore(items: SearchItem[]): void
  load(): Promise<SearchItem[]>
  save(tracks: TrackReference[]): Promise<unknown>
  notice(message: string): void
}

export function createQueuePersistence(options: QueuePersistenceOptions) {
  let ready = false
  let disposed = false
  let loading: Promise<void> | null = null
  let writing: Promise<void> | null = null
  let observed = JSON.stringify(references())
  let saved = observed
  let changedDuringLoad = false
  let failed = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryDelay = 1000

  function references(): TrackReference[] {
    return options.read().map(item => ({ source: item.source, sourceId: item.sourceId }))
  }
  function scheduleRetry() {
    clearTimeout(retryTimer)
    if (disposed) return
    retryTimer = setTimeout(() => { void retry() }, retryDelay)
    retryDelay = Math.min(retryDelay * 2, 30000)
  }
  function reportFailure(message: string) {
    if (!disposed && !failed) options.notice(message)
    failed = true
    scheduleRetry()
  }
  function recovered() {
    if (failed && !disposed) options.notice('播放队列已同步')
    failed = false
    retryDelay = 1000
    clearTimeout(retryTimer)
  }
  async function start() {
    if (ready || disposed) return
    if (loading) return loading
    loading = (async () => {
      try {
        const items = await options.load()
        if (disposed) return
        if (!changedDuringLoad) options.restore(items)
        else if (options.read().length) {
          // 上游读取较慢时保留刚加入的歌曲，也不丢弃上次关闭前的队列。
          const current = [...options.read()]
          const keys = new Set(current.map(item => item.key))
          options.restore([...current, ...items.filter(item => !keys.has(item.key))])
        }
        saved = JSON.stringify(items.map(item => ({ source: item.source, sourceId: item.sourceId })))
        observed = JSON.stringify(references())
        ready = true
        recovered()
        void flush()
      } catch {
        reportFailure('播放队列暂时无法恢复，正在重试；不会覆盖原队列')
      } finally { loading = null }
    })()
    return loading
  }
  function flush(): Promise<void> {
    if (disposed || !ready) return Promise.resolve()
    if (writing) return writing
    // 串行写入并合并中间快照，旧请求不会在新请求之后覆盖最终顺序。
    writing = (async () => {
      while (saved !== observed) {
        const snapshot = observed
        try {
          await options.save(JSON.parse(snapshot) as TrackReference[])
          saved = snapshot
          recovered()
        } catch {
          reportFailure('播放队列尚未保存，正在重试；请保持网页打开')
          break
        }
        if (disposed) break
      }
    })().finally(() => { writing = null })
    return writing
  }
  function changed() {
    if (disposed) return
    const snapshot = JSON.stringify(references())
    if (snapshot === observed) return
    observed = snapshot
    if (!ready) changedDuringLoad = true
    else void flush()
  }
  async function retry() {
    if (disposed) return
    clearTimeout(retryTimer)
    if (!ready) await start()
    else await flush()
  }
  function destroy() {
    // 不写空队列，也不在退出时重置服务端；正常操作已即时发起 keepalive 写入。
    disposed = true
    clearTimeout(retryTimer)
  }
  return { start, changed, retry, flush, destroy }
}
