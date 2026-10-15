// 状态由调用方持有，不创建全局单例；视图只订阅自己需要的实例。
export function createState<T>(initial: T) {
  let value = initial, disposed = false
  const listeners = new Set<(state: T) => void>()
  return {
    get: () => value,
    set(next: T) {
      if (disposed || Object.is(next, value)) return
      value = next
      for (const listener of [...listeners]) if (listeners.has(listener)) listener(value)
    },
    subscribe(listener: (state: T) => void) {
      if (!disposed) listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    destroy() { disposed = true; listeners.clear() },
  }
}
