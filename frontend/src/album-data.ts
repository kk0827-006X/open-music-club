export interface DemoAlbum {
  id: string
  title: string
  artist: string
  year: string
  genre: string
  coverUrl: string
  accent: string
  description: string
  tracks: Array<{ title: string; duration: string }>
}

// 本阶段仅使用静态演示数据；未来由统一 Track/Album 适配层替换。
export const demoAlbums: DemoAlbum[] = [
  {
    id: 'album-001',
    title: '潮汐信号',
    artist: 'Lin Yue',
    year: '2026',
    genre: 'AMBIENT / 夜航',
    coverUrl: '/images/album-placeholder-01.svg',
    accent: '#b77a27',
    description: '缓慢移动的潮线、城市余光与深夜电台，共同构成一份关于归途的声音档案。',
    tracks: [{ title: '风穿过城市的缝隙', duration: '04:39' }, { title: '海面以下', duration: '05:03' }, { title: '远方的灯', duration: '04:36' }],
  },
  {
    id: 'album-002',
    title: '白昼折叠',
    artist: 'North Window',
    year: '2025',
    genre: 'POST ROCK / 光谱',
    coverUrl: '/images/album-placeholder-02.svg',
    accent: '#687b82',
    description: '把清晨到黄昏压缩成五段光谱，以吉他残响记录城市表面不断变化的温度。',
    tracks: [{ title: '晨雾索引', duration: '03:58' }, { title: '十二点以北', duration: '06:14' }, { title: '折叠线', duration: '04:42' }],
  },
  {
    id: 'album-003',
    title: '低空回声',
    artist: 'April Static',
    year: '2024',
    genre: 'ELECTRONIC / 灰蓝',
    coverUrl: '/images/album-placeholder-03.svg',
    accent: '#9a6048',
    description: '采集地铁、风洞和旧磁带噪声，让重复节拍在低空盘旋后逐渐远去。',
    tracks: [{ title: 'Loop 17', duration: '04:07' }, { title: '失真地平线', duration: '05:21' }, { title: '回声降落', duration: '03:49' }],
  },
  {
    id: 'album-004',
    title: '无声花园',
    artist: 'Mori Ensemble',
    year: '2023',
    genre: 'NEO CLASSICAL / 植物',
    coverUrl: '/images/album-placeholder-04.svg',
    accent: '#667358',
    description: '钢琴、弦乐和自然录音在一座没有边界的花园中交叠，留出足够的呼吸空间。',
    tracks: [{ title: '苔藓时钟', duration: '04:51' }, { title: '树影慢板', duration: '06:02' }, { title: '夜间生长', duration: '05:18' }],
  },
  {
    id: 'album-005',
    title: '轨道尽头',
    artist: 'Signal Department',
    year: '2026',
    genre: 'SYNTH / 远行',
    coverUrl: '/images/album-placeholder-05.svg',
    accent: '#856e87',
    description: '一张虚构的列车时刻表，也是五段合成器旋律构成的远行路线。',
    tracks: [{ title: 'Departure 00:17', duration: '03:33' }, { title: '无人站台', duration: '04:48' }, { title: '终点仍在移动', duration: '05:27' }],
  },
]
