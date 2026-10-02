import type { SearchItem } from './music-search.ts'

export class MusicQueue {
  private entries: SearchItem[] = []

  get items(): readonly SearchItem[] { return this.entries }

  add(item: SearchItem) {
    if (item.kind !== 'song' || this.entries.length >= 500 || this.entries.some((entry) => entry.key === item.key)) return
    this.entries.push(item)
  }

  remove(key: string) {
    this.entries = this.entries.filter((entry) => entry.key !== key)
  }

  move(key: string, direction: -1 | 1) {
    const index = this.entries.findIndex((entry) => entry.key === key)
    const next = index + direction
    if (index < 0 || next < 0 || next >= this.entries.length) return
    ;[this.entries[index], this.entries[next]] = [this.entries[next], this.entries[index]]
  }

  next(key: string) {
    const index = this.entries.findIndex((entry) => entry.key === key)
    return this.entries[index + 1] ?? null
  }

  previous(key: string) {
    const index = this.entries.findIndex((entry) => entry.key === key)
    return index > 0 ? this.entries[index - 1] : null
  }

  clear() { this.entries = [] }

  restore(items: readonly SearchItem[]) {
    this.entries = []
    items.forEach(item => this.add(item))
  }
}
