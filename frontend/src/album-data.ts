export interface DemoAlbum {
  id: string
  title: string
  artist: string
  year: string
  genre: string
  coverUrl: string
  accent: string
  description: string
  totalTracks: number
  tracks: Array<{ id: string; title: string; duration: string }>
}

type AlbumRow = [string, string, string, string, string, number, string, string, string]

// 静态目录只承载首页视觉；封面和代表曲目均来自网易云公开专辑资料。
const rows: AlbumRow[] = [
  ['18909', 'Partners 拍档', '周杰伦', '2002', 'fRplesEuiaRKFFcwU7q45w==/109951171358444757.jpg', 13, '186064', '刀马旦', '3:12'],
  ['2489195', '天台 电影原声带', '周杰伦', '2013', 'EtNkS7FBXy8YKmychV7llw==/109951165806257997.jpg', 35, '26609713', '美术馆', '1:22'],
  ['6365', 'DUO 陈奕迅2010演唱会', '陈奕迅', '2010', '7dbK-A_In2Wol92TDMYIGw==/6636652185368776.jpg', 37, '64421', '今天等我来(Live)', '5:31'],
  ['6590', 'Shall We Dance? Shall We Talk!', '陈奕迅', '2001', 'jr5XGr69K4k_U1eBnL-JYw==/109951170241860133.jpg', 13, '67402', '黎喇', '0:13'],
  ['2518003', 'The Key', '陈奕迅', '2013', '1itDj9ETx-njdPKTuptrwQ==/19057835044482433.jpg', 9, '26523013', '主旋律', '4:53'],
  ['6451', "What's Going On…?", '陈奕迅', '2006', 'oSMs7RzJFx0TgWCqRC8XjA==/109951171844247587.jpg', 15, '65758', '裙下之臣', '4:22'],
  ['6491', 'U87', '陈奕迅', '2005', 'W9imJx0w_JeCGGs43dfjFg==/109951171529987110.jpg', 13, '66261', '烂', '4:16'],
  ['95357380', '交换余生', '林俊杰', '2020', 'CTvZ6cIrZ3uZdXbzedrufw==/109951169697336752.jpg', 1, '1479003964', '交换余生', '4:36'],
  ['79214796', '新地球', '林俊杰', '2014', 'xH5uX9f5ymnPgPD5E25myA==/109951164081863001.jpg', 12, '1366053676', '回', '2:13'],
  ['3438282', '和自己对话', '林俊杰', '2015', 'JRxqmFNVw9tc6kCGsyvVbA==/109951169682587779.jpg', 18, '40147551', '序曲：调音', '1:10'],
  ['37085119', '伟大的渺小', '林俊杰', '2017', '577Gt_GgbymKIIpv8XS78Q==/109951169697341100.jpg', 11, '526464394', '圣所', '3:49'],
  ['163678212', '重拾_快乐', '林俊杰', '2023', 'KoBXh31YzOk_cEhAlBm_BQ==/109951168573329172.jpg', 12, '2039156731', '愿与愁', '3:51'],
  ['80752440', 'Lover', 'Taylor Swift', '2019', '6CB6Jsmb7k7qiJqfMY5Row==/109951164260234943.jpg', 20, '1382572453', 'I Forgot That You Existed', '2:50'],
  ['36709029', 'reputation', 'Taylor Swift', '2017', 'fdh0myRe6FD87QNJtvGe_A==/109951163054654501.jpg', 15, '503207093', '...Ready For It?', '3:28'],
  ['135521226', "Red (Taylor's Version)", 'Taylor Swift', '2021', 'DYGaOqXCdIUjT2Wj7lvsqQ==/109951168852611462.jpg', 30, '1891454307', "State Of Grace (Taylor's Version)", '4:55'],
  ['153345099', 'Midnights (3am Edition)', 'Taylor Swift', '2022', 'lKhXKmONQahzGsRdhoDR7w==/109951168178695711.jpg', 20, '1990192689', 'Lavender Haze', '3:22'],
  ['92895788', 'folklore (deluxe version)', 'Taylor Swift', '2020', 'b_6ZbpOz55g8oB4KR34aFw==/109951168971655174.jpg', 17, '1465111714', 'the 1', '3:30'],
  ['135740501', '30', 'Adele', '2021', 't0G-13az8_lEnrDRRntLWA==/109951166639576807.jpg', 12, '1892652658', 'Strangers By Nature', '3:02'],
  ['3377045', '25', 'Adele', '2015', 'GBjkPuYOKYFaXtEjA6ULqA==/109951168110232012.jpg', 11, '36841430', 'Hello', '4:55'],
  ['213252', '21', 'Adele', '2011', '-aAWuK0-91lgZmDGx7V_kA==/109951172658442765.jpg', 11, '2116996', 'Rolling in the Deep', '3:48'],
  ['1582605', 'Parachutes', 'Coldplay', '2000', '3ayPqZSNgaBLGpCbfBEzAw==/109951167815565396.jpg', 10, '17177274', "Don't Panic", '2:16'],
  ['2767188', 'Ghost Stories', 'Coldplay', '2014', 'z8bRRuF8Gx5RvHJHwpKKkQ==/109951163620484193.jpg', 12, '28535291', 'Always in My Head', '3:36'],
  ['403157', 'Viva La Vida or Death and All His Friends', 'Coldplay', '2008', 'Wr13D68yaaknFmxTD5xnoQ==/18569651881855121.jpg', 12, '3985995', 'Life in Technicolor', '2:29'],
  ['3419156', 'A Head Full of Dreams', 'Coldplay', '2015', 'BtsEBmnJ05DLBxMdWdhNpA==/109951163780293240.jpg', 12, '37240628', 'A Head Full Of Dreams', '3:43'],
]

export const demoAlbums: DemoAlbum[] = rows.map(([id, title, artist, year, cover, totalTracks, trackId, trackTitle, duration]) => ({
  id,
  title,
  artist,
  year,
  genre: '流行 / POP',
  coverUrl: `https://p1.music.126.net/${cover}`,
  accent: '#ac7b42',
  description: `${artist} 的专辑《${title}》。封面与代表曲目来自网易云音乐；实际播放可用性以上游返回为准。`,
  totalTracks,
  tracks: [{ id: trackId, title: trackTitle, duration }],
}))
