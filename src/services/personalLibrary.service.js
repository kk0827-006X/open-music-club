const { toTrack } = require('../db/localMusic')

class SourceLookupError extends Error {}

function safeCover(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !(url.hostname === 'music.126.net' || url.hostname.endsWith('.music.126.net'))) return null
    url.protocol = 'https:'
    return url.href
  } catch {
    return null
  }
}

function toNeteaseTrack(song) {
  const id = String(song.id)
  return {
    source: 'netease', sourceId: id, trackKey: `netease:${id}`,
    title: song.name,
    artists: Array.isArray(song.ar) ? song.ar.map((artist) => ({
      id: artist.id == null ? null : String(artist.id), name: artist.name,
    })) : [],
    album: { id: song.al?.id == null ? null : String(song.al.id), name: song.al?.name || null },
    durationMs: Number.isSafeInteger(song.dt) ? song.dt : 0,
    coverUrl: safeCover(song.al?.picUrl),
    streamUrl: null,
    playable: true,
    playback: { kind: 'netease-resolve', id, level: 'standard' },
  }
}

function unavailableTrack(reference) {
  return {
    source: reference.source,
    sourceId: reference.source_id,
    trackKey: `${reference.source}:${reference.source_id}`,
    title: '暂不可用', artists: [], album: { id: null, name: null },
    durationMs: 0, coverUrl: null, streamUrl: null, playable: false,
    playback: null,
  }
}

function createPersonalLibraryService({ database, neteaseService }) {
  async function fetchNetease(ids) {
    const songs = new Map()
    for (let index = 0; index < ids.length; index += 100) {
      const batch = ids.slice(index, index + 100)
      let body
      try {
        body = await neteaseService.call('songDetail', { ids: batch.join(',') })
      } catch {
        throw new SourceLookupError('网易云服务暂时不可用')
      }
      if (body?.code !== 200 || !Array.isArray(body.songs)) {
        throw new SourceLookupError('网易云服务暂时不可用')
      }
      for (const song of body.songs) {
        if (song && Number.isSafeInteger(song.id) && typeof song.name === 'string') {
          songs.set(String(song.id), toNeteaseTrack(song))
        }
      }
    }
    return songs
  }

  async function verifyReference(source, sourceId) {
    if (source === 'local') {
      return Boolean(database.prepare('SELECT id FROM uploaded_music WHERE id = ?').get(sourceId))
    }
    const songs = await fetchNetease([sourceId])
    return songs.has(sourceId)
  }

  async function hydrate(references) {
    if (references.length === 0) return []
    const localIds = [...new Set(references.filter((item) => item.source === 'local').map((item) => item.source_id))]
    const neteaseIds = [...new Set(references.filter((item) => item.source === 'netease').map((item) => item.source_id))]
    const locals = new Map()
    if (localIds.length) {
      const placeholders = localIds.map(() => '?').join(',')
      const rows = database.prepare(`SELECT m.*, u.nickname AS uploader_nickname
        FROM uploaded_music m JOIN users u ON u.id = m.uploader_id
        WHERE m.id IN (${placeholders})`).all(...localIds)
      rows.forEach((row) => locals.set(String(row.id), toTrack(row)))
    }
    let netease = new Map()
    if (neteaseIds.length) {
      try {
        netease = await fetchNetease(neteaseIds)
      } catch (error) {
        if (!(error instanceof SourceLookupError)) throw error
      }
    }
    return references.map((reference) => ({
      ...((reference.source === 'local' ? locals : netease).get(reference.source_id) || unavailableTrack(reference)),
      ...(reference.id === undefined ? {} : { entryId: reference.id }),
      ...(reference.position === undefined ? {} : { position: reference.position }),
      ...(reference.added_at === undefined ? {} : { addedAt: reference.added_at }),
      ...(reference.created_at === undefined ? {} : { likedAt: reference.created_at }),
    }))
  }

  return { hydrate, verifyReference }
}

module.exports = { createPersonalLibraryService, SourceLookupError }
